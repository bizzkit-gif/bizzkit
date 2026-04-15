import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type RequestBody = {
  businessId?: string;
  subscription?: {
    endpoint?: string;
    auth?: string;
    p256dh?: string;
  };
  userAgent?: string;
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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

    const body = (await req.json()) as RequestBody;
    const businessId = body.businessId?.trim() ?? "";
    const endpoint = body.subscription?.endpoint?.trim() ?? "";
    const auth = body.subscription?.auth?.trim() ?? "";
    const p256dh = body.subscription?.p256dh?.trim() ?? "";
    const userAgent = body.userAgent?.trim() ?? "";
    if (!businessId || !endpoint || !auth || !p256dh) {
      return new Response(JSON.stringify({ error: "businessId and subscription fields are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: biz, error: bizErr } = await admin
      .from("businesses")
      .select("id")
      .eq("id", businessId)
      .eq("owner_id", auth.user.id)
      .maybeSingle<{ id: string }>();
    if (bizErr || !biz) {
      return new Response(JSON.stringify({ error: "Business not found for current user" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: upsertErr } = await admin
      .from("push_subscriptions")
      .upsert(
        {
          business_id: businessId,
          endpoint,
          auth,
          p256dh,
          user_agent: userAgent,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" }
      );
    if (upsertErr) {
      return new Response(JSON.stringify({ error: upsertErr.message }), {
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

