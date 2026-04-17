import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4";

const CONFIRM = "DELETE MY ACCOUNT";

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

    const { data: bizRows, error: bizListErr } = await admin.from("businesses").select("id").eq("owner_id", uid);
    if (bizListErr) {
      return new Response(JSON.stringify({ error: bizListErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const bizIds = (bizRows || []).map((r: { id: string }) => r.id);

    const { error: savedUserErr } = await admin.from("saved_businesses").delete().eq("user_id", uid);
    if (savedUserErr) {
      return new Response(JSON.stringify({ error: "saved_businesses (user): " + savedUserErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (bizIds.length) {
      const { data: postRows } = await admin.from("posts").select("id").in("business_id", bizIds);
      const postIds = (postRows || []).map((p: { id: string }) => p.id);
      if (postIds.length) {
        const { error: e1 } = await admin.from("post_likes").delete().in("post_id", postIds);
        if (e1) {
          return new Response(JSON.stringify({ error: "post_likes (posts): " + e1.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      const { error: e2 } = await admin.from("post_likes").delete().in("business_id", bizIds);
      if (e2) {
        return new Response(JSON.stringify({ error: "post_likes (business): " + e2.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error: e3 } = await admin.from("posts").delete().in("business_id", bizIds);
      if (e3) {
        return new Response(JSON.stringify({ error: "posts: " + e3.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error: e4 } = await admin.from("push_subscriptions").delete().in("business_id", bizIds);
      if (e4) {
        return new Response(JSON.stringify({ error: "push_subscriptions: " + e4.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error: e5 } = await admin.from("kyc_submissions").delete().in("business_id", bizIds);
      if (e5) {
        return new Response(JSON.stringify({ error: "kyc_submissions: " + e5.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error: e6 } = await admin.from("products").delete().in("business_id", bizIds);
      if (e6) {
        return new Response(JSON.stringify({ error: "products: " + e6.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: myConfRows } = await admin.from("conferences").select("id").in("organizer_id", bizIds);
      const myConfIds = (myConfRows || []).map((c: { id: string }) => c.id);
      if (myConfIds.length) {
        const { error: ec1 } = await admin.from("conference_attendees").delete().in("conference_id", myConfIds);
        if (ec1) {
          return new Response(JSON.stringify({ error: "conference_attendees (organizer confs): " + ec1.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const { error: ec2 } = await admin.from("conferences").delete().in("id", myConfIds);
        if (ec2) {
          return new Response(JSON.stringify({ error: "conferences: " + ec2.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      const { error: e7 } = await admin.from("conference_attendees").delete().in("business_id", bizIds);
      if (e7) {
        return new Response(JSON.stringify({ error: "conference_attendees (business): " + e7.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: ca } = await admin.from("chats").select("id").in("participant_a", bizIds);
      const { data: cb } = await admin.from("chats").select("id").in("participant_b", bizIds);
      const chatIdSet = new Set<string>();
      for (const r of ca || []) chatIdSet.add((r as { id: string }).id);
      for (const r of cb || []) chatIdSet.add((r as { id: string }).id);
      const chatIds = [...chatIdSet];
      if (chatIds.length) {
        const { error: em } = await admin.from("messages").delete().in("chat_id", chatIds);
        if (em) {
          return new Response(JSON.stringify({ error: "messages: " + em.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const { error: ech } = await admin.from("chats").delete().in("id", chatIds);
        if (ech) {
          return new Response(JSON.stringify({ error: "chats: " + ech.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      const { error: ecA } = await admin.from("connections").delete().in("from_biz_id", bizIds);
      if (ecA) {
        return new Response(JSON.stringify({ error: "connections (from): " + ecA.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { error: ecB } = await admin.from("connections").delete().in("to_biz_id", bizIds);
      if (ecB) {
        return new Response(JSON.stringify({ error: "connections (to): " + ecB.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error: esb } = await admin.from("saved_businesses").delete().in("business_id", bizIds);
      if (esb) {
        return new Response(JSON.stringify({ error: "saved_businesses (business): " + esb.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error: eb } = await admin.from("businesses").delete().eq("owner_id", uid);
      if (eb) {
        return new Response(JSON.stringify({ error: "businesses: " + eb.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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
