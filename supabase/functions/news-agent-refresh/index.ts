import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4";

type ParsedNews = {
  title: string;
  articleUrl: string;
  sourceName: string;
  publishedAt: string;
  summary: string;
  imageUrl: string | null;
  industry: string;
  scope: "global" | "local";
  city: string | null;
  country: string | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NEWS_REFRESH_MS = 20 * 60 * 1000;

function normalizeLocation(input: unknown): string {
  return typeof input === "string" ? input.trim().toLowerCase() : "";
}

function decodeHtml(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(raw: string): string {
  return decodeHtml(raw).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function summarizeLikeInShorts(text: string): string {
  const cleaned = stripHtml(text);
  if (!cleaned) return "";
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
  const chosen = sentences.slice(0, 2).join(" ");
  const clipped = (chosen || cleaned).trim();
  if (clipped.length <= 185) return clipped;
  return `${clipped.slice(0, 182).trimEnd()}...`;
}

function industryFromText(text: string): string {
  const t = text.toLowerCase();
  if (/(ai|software|tech|cloud|saas|chip)/.test(t)) return "Technology";
  if (/(bank|fund|invest|stock|ipo|finance)/.test(t)) return "Finance";
  if (/(retail|ecommerce|shop|consumer)/.test(t)) return "Retail";
  if (/(energy|oil|gas|renewable)/.test(t)) return "Energy";
  if (/(health|pharma|biotech|hospital)/.test(t)) return "Healthcare";
  if (/(factory|manufactur|supply chain|logistics)/.test(t)) return "Manufacturing";
  if (/(food|restaurant|beverage|agri|farm)/.test(t)) return "Food & Beverage";
  return "Other";
}

function hashKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function extractTagValue(item: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  return decodeHtml(item.match(re)?.[1] || "").trim();
}

function parseRssItems(xml: string): Array<Record<string, string>> {
  const matches = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  return matches.map((item) => ({
    title: extractTagValue(item, "title"),
    link: extractTagValue(item, "link"),
    description: extractTagValue(item, "description"),
    pubDate: extractTagValue(item, "pubDate"),
    source: extractTagValue(item, "source"),
  }));
}

async function fetchRss(url: string): Promise<Array<Record<string, string>>> {
  const res = await fetch(url, { headers: { "User-Agent": "bizzkit-news-agent/1.0" } });
  if (!res.ok) return [];
  const xml = await res.text();
  return parseRssItems(xml);
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

    const body = (await req.json().catch(() => ({}))) as { city?: string; country?: string };
    const city = normalizeLocation(body.city);
    const country = normalizeLocation(body.country);
    const localKey = `${city}|${country}`;

    const { data: existingLocal } = await admin
      .from("news_cards")
      .select("created_at")
      .eq("scope", "local")
      .eq("city", city)
      .eq("country", country)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: existingGlobal } = await admin
      .from("news_cards")
      .select("created_at")
      .eq("scope", "global")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const now = Date.now();
    const shouldRefreshGlobal = !existingGlobal?.created_at
      || (now - new Date(existingGlobal.created_at).getTime()) > NEWS_REFRESH_MS;
    const shouldRefreshLocal = !!city && !!country && (
      !existingLocal?.created_at || (now - new Date(existingLocal.created_at).getTime()) > NEWS_REFRESH_MS
    );

    if (!shouldRefreshGlobal && !shouldRefreshLocal) {
      return new Response(JSON.stringify({ ok: true, refreshed: false }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const allRows: ParsedNews[] = [];

    if (shouldRefreshGlobal) {
      const globalRss = await fetchRss("https://feeds.reuters.com/reuters/businessNews");
      for (const item of globalRss.slice(0, 12)) {
        if (!item.title || !item.link) continue;
        const bodyText = `${item.title}. ${item.description || ""}`;
        allRows.push({
          title: stripHtml(item.title),
          articleUrl: item.link,
          sourceName: item.source || "Reuters",
          publishedAt: item.pubDate || new Date().toISOString(),
          summary: summarizeLikeInShorts(bodyText),
          imageUrl: null,
          industry: industryFromText(bodyText),
          scope: "global",
          city: null,
          country: null,
        });
      }
    }

    if (shouldRefreshLocal) {
      const query = encodeURIComponent(`${city} ${country} business`);
      const localRss = await fetchRss(`https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`);
      for (const item of localRss.slice(0, 10)) {
        if (!item.title || !item.link) continue;
        const bodyText = `${item.title}. ${item.description || ""}`;
        allRows.push({
          title: stripHtml(item.title),
          articleUrl: item.link,
          sourceName: "Google News",
          publishedAt: item.pubDate || new Date().toISOString(),
          summary: summarizeLikeInShorts(bodyText),
          imageUrl: null,
          industry: industryFromText(bodyText),
          scope: "local",
          city,
          country,
        });
      }
    }

    if (!allRows.length) {
      return new Response(JSON.stringify({ ok: true, refreshed: true, inserted: 0, key: localKey }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = allRows.map((n) => ({
      scope: n.scope,
      city: n.city,
      country: n.country,
      title: n.title,
      summary: n.summary || n.title,
      source_name: n.sourceName,
      article_url: n.articleUrl,
      image_url: n.imageUrl,
      industry: n.industry,
      published_at: new Date(n.publishedAt).toISOString(),
      dedupe_hash: hashKey(`${n.scope}|${n.city || ""}|${n.country || ""}|${n.articleUrl}`),
    }));

    const { error: upsertErr } = await admin
      .from("news_cards")
      .upsert(payload, { onConflict: "dedupe_hash", ignoreDuplicates: false });

    if (upsertErr) {
      return new Response(JSON.stringify({ error: upsertErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, refreshed: true, inserted: payload.length, key: localKey }), {
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
