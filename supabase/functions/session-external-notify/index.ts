import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Body = {
  conferenceId?: string;
  recipientBusinessId?: string;
  senderBusinessId?: string;
  kind?: "invite" | "reminder";
};

function errJson(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sendResendEmail(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  text: string,
): Promise<{ ok: boolean; skipped?: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, text }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.warn("Resend error:", res.status, errText);
    return { ok: false, skipped: "email_failed" };
  }
  return { ok: true };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    const resendFrom = Deno.env.get("RESEND_FROM_EMAIL") ?? "Bizzkit <onboarding@resend.dev>";
    const appUrl = (Deno.env.get("PUBLIC_APP_URL") ?? "https://bizzkit.app").replace(/\/$/, "");

    if (!supabaseUrl || !serviceKey || !anonKey) {
      return errJson(500, "Missing Supabase environment configuration");
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: auth, error: authErr } = await userClient.auth.getUser();
    if (authErr || !auth?.user) return errJson(401, authErr?.message || "Unauthorized");

    const body = (await req.json()) as Body;
    const conferenceId = body.conferenceId?.trim() ?? "";
    const recipientBusinessId = body.recipientBusinessId?.trim() ?? "";
    const senderBusinessId = body.senderBusinessId?.trim() ?? "";
    const kind = body.kind === "reminder" ? "reminder" : "invite";

    if (!conferenceId || !recipientBusinessId || !senderBusinessId) {
      return errJson(400, "conferenceId, recipientBusinessId, and senderBusinessId are required");
    }

    const { data: senderBiz, error: senderErr } = await admin
      .from("businesses")
      .select("id,name,owner_id")
      .eq("id", senderBusinessId)
      .eq("owner_id", auth.user.id)
      .maybeSingle<{ id: string; name: string; owner_id: string }>();
    if (senderErr || !senderBiz) return errJson(403, "Sender business is not owned by current user");

    const { data: conf, error: confErr } = await admin
      .from("conferences")
      .select("id,organizer_id,title,date,time,status")
      .eq("id", conferenceId)
      .maybeSingle<{
        id: string;
        organizer_id: string;
        title: string;
        date: string;
        time: string;
        status: string;
      }>();
    if (confErr || !conf) return errJson(404, "Conference not found");
    if (conf.status === "closed") return errJson(400, "Conference is closed");

    if (kind === "reminder") {
      if (conf.organizer_id !== senderBusinessId) {
        return errJson(403, "Only the host can send reminder notifications");
      }
    } else {
      const isOrganizer = conf.organizer_id === senderBusinessId;
      if (!isOrganizer) {
        const { data: att } = await admin
          .from("conference_attendees")
          .select("business_id")
          .eq("conference_id", conferenceId)
          .eq("business_id", senderBusinessId)
          .maybeSingle();
        if (!att) return errJson(403, "You must join this session to invite others");
      }
      const { data: connA } = await admin
        .from("connections")
        .select("id")
        .eq("from_biz_id", senderBusinessId)
        .eq("to_biz_id", recipientBusinessId)
        .maybeSingle();
      const { data: connB } = await admin
        .from("connections")
        .select("id")
        .eq("from_biz_id", recipientBusinessId)
        .eq("to_biz_id", senderBusinessId)
        .maybeSingle();
      if (!connA && !connB) return errJson(403, "You can only invite connected businesses");
    }

    const { data: recipient, error: recErr } = await admin
      .from("businesses")
      .select("id,name,owner_id,notify_session_invite_email,notify_session_calendar_reminders")
      .eq("id", recipientBusinessId)
      .maybeSingle<{
        id: string;
        name: string;
        owner_id: string;
        notify_session_invite_email: boolean;
        notify_session_calendar_reminders: boolean;
      }>();
    if (recErr || !recipient) return errJson(404, "Recipient business not found");

    const inviterName = (senderBiz.name || "Someone").trim() || "Someone";
    const sessionLine = `"${conf.title}" — ${conf.date} at ${conf.time}`;
    const inviteText =
      `${inviterName} invited you to a Bizzkit session: ${sessionLine}. Open the app: Connect → Conferences. ${appUrl}`;
    const reminderText =
      `Reminder: "${conf.title}" starts soon (${conf.time}). Join on time in Bizzkit → Connect → Conferences. ${appUrl}`;

    const emailBody = kind === "invite" ? inviteText : reminderText;
    const emailSubject =
      kind === "invite"
        ? `${inviterName} invited you — ${conf.title}`
        : `Reminder: ${conf.title} starts soon`;

    const wantEmail =
      kind === "invite"
        ? recipient.notify_session_invite_email
        : recipient.notify_session_calendar_reminders;

    const { data: ownerUser } = await admin.auth.admin.getUserById(recipient.owner_id);
    const recipientEmail =
      ownerUser?.user?.email && typeof ownerUser.user.email === "string"
        ? ownerUser.user.email.trim().toLowerCase()
        : "";

    let emailSent = false;
    const skipped: string[] = [];

    if (wantEmail && recipientEmail) {
      if (!resendKey) {
        skipped.push("email_no_resend_key");
      } else {
        const r = await sendResendEmail(resendKey, resendFrom, recipientEmail, emailSubject, emailBody);
        emailSent = r.ok;
        if (!r.ok && r.skipped) skipped.push(r.skipped);
      }
    } else if (wantEmail && !recipientEmail) {
      skipped.push("email_no_address");
    }

    return new Response(
      JSON.stringify({
        ok: true,
        kind,
        emailSent,
        skipped: skipped.length ? skipped : undefined,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unexpected error";
    return errJson(500, message);
  }
});
