import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type PushRequestBody = {
  recipientBusinessId?: string;
  senderBusinessId?: string;
  title?: string;
  body?: string;
  tag?: string;
  url?: string;
};

type PushSubscriptionRow = {
  endpoint: string;
  auth: string;
  p256dh: string;
};

function errJson(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function unreadCountForBusiness(admin: ReturnType<typeof createClient>, businessId: string): Promise<number> {
  const { data: chats } = await admin
    .from("chats")
    .select("id")
    .or(`participant_a.eq.${businessId},participant_b.eq.${businessId}`);
  const chatIds = (chats || []).map((c: { id: string }) => c.id);
  if (!chatIds.length) return 0;
  const { count } = await admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .in("chat_id", chatIds)
    .neq("sender_id", businessId)
    .eq("read", false);
  return count || 0;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const vapidSubject = Deno.env.get("WEB_PUSH_SUBJECT") ?? "mailto:admin@bizzkit.app";
    const vapidPublic = Deno.env.get("WEB_PUSH_PUBLIC_KEY") ?? "";
    const vapidPrivate = Deno.env.get("WEB_PUSH_PRIVATE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey || !anonKey || !vapidPublic || !vapidPrivate) {
      return errJson(500, "Missing Supabase or Web Push environment configuration");
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: auth, error: authErr } = await userClient.auth.getUser();
    if (authErr || !auth?.user) return errJson(401, authErr?.message || "Unauthorized");

    const body = (await req.json()) as PushRequestBody;
    const recipientBusinessId = body.recipientBusinessId?.trim() ?? "";
    const senderBusinessId = body.senderBusinessId?.trim() ?? "";
    const title = body.title?.trim() ?? "Bizzkit";
    const msgBody = body.body?.trim() ?? "You have a new notification.";
    const tag = body.tag?.trim() ?? "bizzkit-notification";
    const url = body.url?.trim() || "/";
    if (!recipientBusinessId || !senderBusinessId) return errJson(400, "recipientBusinessId and senderBusinessId are required");

    const { data: senderBiz, error: senderErr } = await admin
      .from("businesses")
      .select("id,name")
      .eq("id", senderBusinessId)
      .eq("owner_id", auth.user.id)
      .maybeSingle<{ id: string; name: string }>();
    if (senderErr || !senderBiz) return errJson(403, "Sender business is not owned by current user");

    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("endpoint,auth,p256dh")
      .eq("business_id", recipientBusinessId);
    const subscriptions = (subs || []) as PushSubscriptionRow[];
    if (!subscriptions.length) {
      return new Response(JSON.stringify({ ok: true, delivered: 0, removed: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const badgeCount = await unreadCountForBusiness(admin, recipientBusinessId);
    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

    const payload = JSON.stringify({
      title,
      body: msgBody,
      tag,
      url,
      badgeCount,
      senderBusinessId,
      recipientBusinessId,
    });

    let delivered = 0;
    const staleEndpoints: string[] = [];
    await Promise.all(
      subscriptions.map(async (s) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: s.endpoint,
              keys: { auth: s.auth, p256dh: s.p256dh },
            },
            payload
          );
          delivered += 1;
        } catch (e) {
          const statusCode = typeof e === "object" && e && "statusCode" in e ? Number((e as { statusCode?: number }).statusCode) : 0;
          if (statusCode === 404 || statusCode === 410) staleEndpoints.push(s.endpoint);
        }
      })
    );

    if (staleEndpoints.length) {
      await admin.from("push_subscriptions").delete().in("endpoint", staleEndpoints);
    }

    return new Response(JSON.stringify({ ok: true, delivered, removed: staleEndpoints.length }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unexpected error";
    return errJson(500, message);
  }
});

