import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4";

const CONFIRM = "DELETE MY ACCOUNT";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const isMissingRelation = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  if (e.code === "42P01") return true;
  return typeof e.message === "string" && e.message.toLowerCase().includes("does not exist");
};

async function must<T>(label: string, work: Promise<{ data: T | null; error: unknown }>): Promise<T | null> {
  const { data, error } = await work;
  if (error) {
    const e = error as { message?: string };
    throw new Error(`${label}: ${e.message || "unknown error"}`);
  }
  return data;
}

async function optional(label: string, work: Promise<{ error: unknown }>): Promise<void> {
  const { error } = await work;
  if (!error) return;
  if (isMissingRelation(error)) return;
  const e = error as { message?: string };
  throw new Error(`${label}: ${e.message || "unknown error"}`);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!supabaseUrl || !serviceKey || !anonKey) {
      return new Response(JSON.stringify({ error: "Missing Supabase environment configuration" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as { confirm?: string };
    if (body?.confirm !== CONFIRM) {
      return new Response(JSON.stringify({ error: "Invalid confirmation" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: auth, error: authErr } = await userClient.auth.getUser();
    if (authErr || !auth?.user) {
      return new Response(JSON.stringify({ error: authErr?.message || "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const uid = auth.user.id;

    const bizRows = (await must(
      "businesses(list)",
      admin.from("businesses").select("id").eq("owner_id", uid)
    )) || [];
    const bizIds = (bizRows || []).map((r: { id: string }) => r.id);

    await optional("saved_businesses (user)", admin.from("saved_businesses").delete().eq("user_id", uid));

    if (bizIds.length) {
      const postRows = (await must(
        "posts(list)",
        admin.from("posts").select("id").in("business_id", bizIds)
      )) || [];
      const postIds = (postRows || []).map((p: { id: string }) => p.id);
      if (postIds.length) {
        await optional("post_likes (posts)", admin.from("post_likes").delete().in("post_id", postIds));
      }
      await optional("post_likes (business)", admin.from("post_likes").delete().in("business_id", bizIds));
      await optional("posts", admin.from("posts").delete().in("business_id", bizIds));
      await optional("push_subscriptions", admin.from("push_subscriptions").delete().in("business_id", bizIds));
      await optional("kyc_submissions", admin.from("kyc_submissions").delete().in("business_id", bizIds));
      await optional("products", admin.from("products").delete().in("business_id", bizIds));

      const myConfRows = (await must(
        "conferences(list by organizer)",
        admin.from("conferences").select("id").in("organizer_id", bizIds)
      )) || [];
      const myConfIds = (myConfRows || []).map((c: { id: string }) => c.id);
      if (myConfIds.length) {
        await optional(
          "conference_attendees (organizer confs)",
          admin.from("conference_attendees").delete().in("conference_id", myConfIds)
        );
        await optional("conferences", admin.from("conferences").delete().in("id", myConfIds));
      }

      await optional("conference_attendees (business)", admin.from("conference_attendees").delete().in("business_id", bizIds));

      const ca = (await must("chats(list A)", admin.from("chats").select("id").in("participant_a", bizIds))) || [];
      const cb = (await must("chats(list B)", admin.from("chats").select("id").in("participant_b", bizIds))) || [];
      const chatIdSet = new Set<string>();
      for (const r of ca || []) chatIdSet.add((r as { id: string }).id);
      for (const r of cb || []) chatIdSet.add((r as { id: string }).id);
      const chatIds = [...chatIdSet];
      if (chatIds.length) {
        await optional("messages", admin.from("messages").delete().in("chat_id", chatIds));
        await optional("chats", admin.from("chats").delete().in("id", chatIds));
      }

      await optional("connections (from)", admin.from("connections").delete().in("from_biz_id", bizIds));
      await optional("connections (to)", admin.from("connections").delete().in("to_biz_id", bizIds));
      await optional("saved_businesses (business)", admin.from("saved_businesses").delete().in("business_id", bizIds));
      await must("businesses(delete)", admin.from("businesses").delete().eq("owner_id", uid));
    }

    const { error: delUserErr } = await admin.auth.admin.deleteUser(uid);
    if (delUserErr) {
      return new Response(JSON.stringify({ error: delUserErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unexpected error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
