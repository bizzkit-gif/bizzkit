import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: "Missing Supabase environment configuration" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: auth, error: authErr } = await admin.auth.getUser(jwt);
    if (authErr || !auth?.user) {
      return new Response(JSON.stringify({ error: authErr?.message || "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: rows, error } = await admin
      .from("businesses")
      .select("id,owner_id,name,tagline,industry,city,country,type,logo,logo_url,kyc_verified,trust_score,products(id,name,emoji,price,category)")
      .order("trust_score", { ascending: false });
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ownerIds = Array.from(
      new Set((rows || []).map((r: { owner_id?: string | null }) => (r.owner_id || "").trim()).filter(Boolean))
    );
    const validOwnerIds = new Set<string>();
    await Promise.all(
      ownerIds.map(async (ownerId) => {
        const { data: owner, error: ownerErr } = await admin.auth.admin.getUserById(ownerId);
        if (!ownerErr && owner?.user?.id) validOwnerIds.add(owner.user.id);
      })
    );
    const filtered = (rows || []).filter((r: { owner_id?: string | null }) => {
      const oid = (r.owner_id || "").trim();
      return !!oid && validOwnerIds.has(oid);
    });

    return new Response(JSON.stringify({ rows: filtered }), {
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
