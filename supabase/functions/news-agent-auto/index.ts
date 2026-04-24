import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4";

type ParsedNews = {
  title: string;
  articleUrl: string;
  sourceName: string;
  publishedAt: string;
  summary: string;
  fullText: string;
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
const BUSINESS_INCLUDE = /(business|economy|economic|market|startup|funding|finance|bank|stock|ipo|industry|manufactur|retail|company|companies|trade|investment|investor|merger|acquisition|supply chain|logistics|b2b|enterprise)/i;
const NON_BUSINESS_EXCLUDE = /(weather|storm|rainfall|snow|hurricane|cyclone|thunderstorm|heatwave|temperature|forecast|climate alert|air quality|pollen|wildfire|earthquake|flood warning)/i;
const RUSSIAN_EXCLUDE = /(?:\b(russia|russian|moscow|kremlin|putin|россия|русск|москва|кремл|путин)\b|[\u0400-\u04FF])/i;

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
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripHtml(raw: string): string {
  return decodeHtml(raw).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function stripUrlsAndDomains(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b(?:www\.)?[a-z0-9-]+\.(?:com|in|net|org|co|io|biz|info|news|tv|uk|me|ai)(?:\/\S*)?\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripSourceTail(text: string): string {
  return text
    .replace(/\s[-|:]\s*[A-Za-z0-9 .,&'-]{2,40}$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isHeadlineLike(line: string, headline: string): boolean {
  const l = stripUrlsAndDomains(line).toLowerCase();
  const h = stripUrlsAndDomains(headline).toLowerCase();
  if (!l || !h) return false;
  if (l === h) return true;
  if (l.includes(h) || h.includes(l)) return true;
  const titleTokens = h.split(/\s+/).filter((w) => w.length > 3);
  if (!titleTokens.length) return false;
  const overlap = titleTokens.filter((t) => l.includes(t)).length / titleTokens.length;
  return overlap >= 0.75;
}

function buildSummary(headline: string, fullText: string, fallbackText: string): string {
  const cleanHeadline = stripSourceTail(stripUrlsAndDomains(stripHtml(headline)));
  const base = stripUrlsAndDomains(stripHtml(fullText || fallbackText || ""));
  if (!base) return cleanHeadline;

  const sentences = base
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40 && s.length <= 300)
    .filter((s) => !/(subscribe|newsletter|all rights reserved|copyright|read more|watch live)/i.test(s))
    .filter((s) => !isHeadlineLike(s, cleanHeadline));

  const chosen: string[] = [];
  let charCount = 0;
  for (const s of sentences) {
    const nextLen = charCount + s.length + (chosen.length ? 1 : 0);
    if (nextLen > 1800) break; // ~ up to 25 lines in mobile modal.
    chosen.push(s);
    charCount = nextLen;
    if (chosen.length >= 12) break;
  }

  const joined = chosen.join(" ").trim();
  if (!joined) {
    const fallback = base.slice(0, 1800).trim();
    return fallback || cleanHeadline;
  }
  return joined;
}

function normalizeArticleText(raw: string): string {
  return stripHtml(raw).replace(/\s+/g, " ").trim();
}

async function fetchArticleReadableText(articleUrl: string, fallback: string): Promise<string> {
  try {
    const res = await fetch(articleUrl, {
      headers: { "User-Agent": "bizzkit-news-agent/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return fallback;
    const html = await res.text();
    const cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
    const paragraphs = (cleaned.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [])
      .map((p) => normalizeArticleText(p))
      .filter((p) => p.length > 40);
    const merged = paragraphs.slice(0, 30).join("\n\n").trim();
    if (merged.length >= 180) return merged;
    const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || cleaned;
    const bodyText = normalizeArticleText(bodyMatch).slice(0, 9000).trim();
    if (bodyText.length >= 180) return bodyText;
    const fallbackCombined = `${fallback}\n\n${paragraphs.slice(0, 8).join("\n\n")}`.trim();
    return fallbackCombined || fallback;
  } catch {
    return fallback;
  }
}

function isBusinessNews(text: string): boolean {
  const t = stripHtml(text);
  if (!t) return false;
  if (NON_BUSINESS_EXCLUDE.test(t)) return false;
  if (RUSSIAN_EXCLUDE.test(t)) return false;
  return BUSINESS_INCLUDE.test(t);
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
  try {
    const res = await fetch(url, { headers: { "User-Agent": "bizzkit-news-agent/1.0" } });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRssItems(xml);
  } catch {
    return [];
  }
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

    const body = (await req.json().catch(() => ({}))) as { force?: boolean };
    const forceRefresh = body.force === true;
    const admin = createClient(supabaseUrl, serviceKey);
    const now = Date.now();
    const allRows: ParsedNews[] = [];

    const { data: existingGlobal } = await admin
      .from("news_cards")
      .select("created_at")
      .eq("scope", "global")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const shouldRefreshGlobal = forceRefresh || !existingGlobal?.created_at
      || (now - new Date(existingGlobal.created_at).getTime()) > NEWS_REFRESH_MS;

    if (shouldRefreshGlobal) {
      const globalRss = await fetchRss("https://news.google.com/rss/search?q=global%20business%20news&hl=en-US&gl=US&ceid=US:en");
      for (const item of globalRss.slice(0, 12)) {
        if (!item.title || !item.link) continue;
        const bodyText = `${item.title}. ${item.description || ""}`;
        if (!isBusinessNews(bodyText)) continue;
        const fullText = await fetchArticleReadableText(item.link, stripHtml(bodyText));
        const summary = buildSummary(item.title || "", fullText, bodyText);
        if (!isBusinessNews(`${bodyText} ${fullText}`)) continue;
        allRows.push({
          title: stripSourceTail(stripUrlsAndDomains(stripHtml(item.title))),
          articleUrl: item.link,
          sourceName: item.source || "Reuters",
          publishedAt: item.pubDate || new Date().toISOString(),
          summary,
          fullText,
          industry: industryFromText(bodyText),
          scope: "global",
          city: null,
          country: null,
        });
      }
    }

    const { data: businessLocations } = await admin
      .from("businesses")
      .select("city,country,updated_at")
      .not("city", "is", null)
      .not("country", "is", null)
      .order("updated_at", { ascending: false })
      .limit(60);

    const seen = new Set<string>();
    const localTargets: Array<{ city: string; country: string }> = [];
    for (const row of businessLocations || []) {
      const city = normalizeLocation((row as { city?: string }).city);
      const country = normalizeLocation((row as { country?: string }).country);
      if (!city || !country) continue;
      const key = `${city}|${country}`;
      if (seen.has(key)) continue;
      seen.add(key);
      localTargets.push({ city, country });
      if (localTargets.length >= 8) break;
    }

    for (const target of localTargets) {
      const { data: existingLocal } = await admin
        .from("news_cards")
        .select("created_at")
        .eq("scope", "local")
        .eq("city", target.city)
        .eq("country", target.country)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const shouldRefreshLocal = forceRefresh || !existingLocal?.created_at
        || (now - new Date(existingLocal.created_at).getTime()) > NEWS_REFRESH_MS;
      if (!shouldRefreshLocal) continue;

      const query = encodeURIComponent(`${target.city} ${target.country} business`);
      const localRss = await fetchRss(`https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`);
      for (const item of localRss.slice(0, 8)) {
        if (!item.title || !item.link) continue;
        const bodyText = `${item.title}. ${item.description || ""}`;
        if (!isBusinessNews(bodyText)) continue;
        const fullText = await fetchArticleReadableText(item.link, stripHtml(bodyText));
        const summary = buildSummary(item.title || "", fullText, bodyText);
        if (!isBusinessNews(`${bodyText} ${fullText}`)) continue;
        allRows.push({
          title: stripSourceTail(stripUrlsAndDomains(stripHtml(item.title))),
          articleUrl: item.link,
          sourceName: "Google News",
          publishedAt: item.pubDate || new Date().toISOString(),
          summary,
          fullText,
          industry: industryFromText(bodyText),
          scope: "local",
          city: target.city,
          country: target.country,
        });
      }
    }

    if (!allRows.length) {
      return new Response(JSON.stringify({ ok: true, inserted: 0 }), {
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
      full_text: n.fullText || n.summary || n.title,
      source_name: n.sourceName,
      article_url: n.articleUrl,
      image_url: null,
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

    return new Response(JSON.stringify({ ok: true, inserted: payload.length }), {
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
