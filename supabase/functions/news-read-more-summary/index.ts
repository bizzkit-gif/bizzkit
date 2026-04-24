import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function decodeHtml(raw: string): string {
  return raw
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripNoise(text: string): string {
  return decodeHtml(text || "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b(?:www\.)?[a-z0-9-]+\.(?:com|in|net|org|co|io|biz|info|news|tv|uk|me|ai)(?:\/\S*)?\b/gi, " ")
    .replace(/\s[-|:]\s*[A-Za-z0-9 .,&'-]{2,40}$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function headlineLike(line: string, headline: string): boolean {
  const l = stripNoise(line).toLowerCase();
  const h = stripNoise(headline).toLowerCase();
  if (!l || !h) return false;
  if (l === h || l.includes(h) || h.includes(l)) return true;
  const titleTokens = h.split(/\s+/).filter((w) => w.length > 3);
  if (!titleTokens.length) return false;
  const overlap = titleTokens.filter((t) => l.includes(t)).length / titleTokens.length;
  return overlap >= 0.75;
}

function buildLongSummary(headline: string, text: string): string {
  const cleanHeadline = stripNoise(headline);
  const base = stripNoise(text);
  if (!base) return cleanHeadline;

  const sentences = base
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 35 && s.length <= 320)
    .filter((s) => !/(subscribe|newsletter|all rights reserved|copyright|read more|watch live|advertis)/i.test(s))
    .filter((s) => !headlineLike(s, cleanHeadline));

  const selected: string[] = [];
  let total = 0;
  for (const s of sentences) {
    const next = total + s.length + (selected.length ? 1 : 0);
    if (next > 2200) break; // roughly <= 25 lines on mobile
    selected.push(s);
    total = next;
    if (selected.length >= 16) break;
  }

  return (selected.join(" ") || base.slice(0, 2200) || cleanHeadline).trim();
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
    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: "Missing Supabase environment configuration" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(supabaseUrl, serviceKey);
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: auth, error: authErr } = await admin.auth.getUser(jwt);
    if (authErr || !auth?.user) {
      return new Response(JSON.stringify({ error: authErr?.message || "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json().catch(() => ({}))) as { headline?: string; articleUrl?: string; fallbackText?: string };
    const headline = stripNoise(body.headline || "");
    const articleUrl = (body.articleUrl || "").trim();
    const fallbackText = stripNoise(body.fallbackText || "");
    if (!headline) {
      return new Response(JSON.stringify({ error: "Missing headline" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let readable = fallbackText;
    if (articleUrl) {
      try {
        const readerUrl = `https://r.jina.ai/http://${articleUrl.replace(/^https?:\/\//i, "")}`;
        const res = await fetch(readerUrl, {
          headers: { "User-Agent": "bizzkit-news-summary/1.0" },
          signal: AbortSignal.timeout(12000),
        });
        if (res.ok) {
          const txt = await res.text();
          readable = stripNoise(txt);
        }
      } catch {
        // fallback only
      }
    }

    const summary = buildLongSummary(headline, readable || fallbackText || headline);
    return new Response(JSON.stringify({ headline, summary }), {
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
