import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4";

type ParsedNews = {
  title: string;
  articleUrl: string;
  sourceName: string;
  publishedAt: string;
  summary: string;
  fullText: string;
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
const BUSINESS_INCLUDE = /(business|economy|economic|market|startup|funding|finance|bank|stock|ipo|industry|manufactur|retail|company|companies|trade|investment|investor|merger|acquisition|supply chain|logistics|b2b|enterprise|earnings|revenue|profit|fiscal|quarter|q1|q2|q3|q4)/i;
const NON_BUSINESS_EXCLUDE = /(weather|storm|rainfall|snow|hurricane|cyclone|thunderstorm|heatwave|temperature|forecast|climate alert|air quality|pollen|wildfire|earthquake|flood warning)/i;
const RUSSIAN_EXCLUDE = /(?:\b(russia|russian|moscow|kremlin|putin|россия|русск|москва|кремл|путин)\b|[\u0400-\u04FF])/i;
const LIVEMINT_ONLY = /livemint\.com/i;
const LIVEMINT_BUSINESS_PATH = /\/(companies|markets|industry|money|economy|technology|startup|companies\/news|market\/stock-market-news)\//i;
const LIVEMINT_FEEDS = [
  "https://www.livemint.com/rss/news",
  "https://www.livemint.com/rss/companies",
  "https://www.livemint.com/rss/markets",
  "https://www.livemint.com/rss/money",
  "https://www.livemint.com/rss/industry",
];
const MIN_NEWS_CARDS = 10;

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

function tokenSet(text: string): Set<string> {
  return new Set(
    stripUrlsAndDomains(stripHtml(text))
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((w) => w.length >= 4),
  );
}

function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) inter += 1;
  }
  return inter / Math.max(1, Math.min(a.size, b.size));
}

function isLowQualityStory(headline: string, summary: string, fullText: string): boolean {
  const h = stripSourceTail(stripUrlsAndDomains(stripHtml(headline)));
  const s = stripUrlsAndDomains(stripHtml(summary));
  const f = stripUrlsAndDomains(stripHtml(fullText));
  if (!h || !s) return true;
  if (s.length < 80) return true;
  const hTokens = tokenSet(h);
  const sTokens = tokenSet(s);
  const fTokens = tokenSet(f);
  const hsOverlap = overlapRatio(hTokens, sTokens);
  const sfOverlap = overlapRatio(sTokens, fTokens);
  const repeatedHeadline = s.toLowerCase().split(h.toLowerCase()).length - 1 >= 3;
  const hasNovelInfo = sTokens.size >= Math.max(10, hTokens.size + 4);
  if (repeatedHeadline) return true;
  if (hsOverlap > 0.92 && !hasNovelInfo) return true;
  if (f && sfOverlap < 0.12 && s.length < 220) return true;
  const leadershipHeadline = /\b(names?|appoints?|appointed|ceo|cfo|chairman|md|managing director)\b/i.test(h);
  if (leadershipHeadline) {
    const detailSignals = /\b(effective|replac|succeed|former|previously|strategy|growth|expansion|market|revenue|profit|quarter|fiscal|operations|portfolio|business unit|reported|guidance)\b/i;
    if (!detailSignals.test(s) || sTokens.size < hTokens.size + 5) return true;
  }
  return false;
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

function isBusinessNews(text: string, articleUrl: string): boolean {
  const t = stripHtml(text);
  if (!t) return false;
  if (NON_BUSINESS_EXCLUDE.test(t)) return false;
  if (RUSSIAN_EXCLUDE.test(t)) return false;
  const byText = BUSINESS_INCLUDE.test(t);
  const byPath = LIVEMINT_BUSINESS_PATH.test(articleUrl || "");
  return byText || byPath;
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

function normalizedHeadlineKey(title: string): string {
  return stripSourceTail(stripUrlsAndDomains(stripHtml(title)))
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|a|an|to|for|of|in|on|at|with|from|by|and)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function headlineSimilarity(a: string, b: string): number {
  const aa = new Set(a.split(/\s+/).filter((w) => w.length >= 3));
  const bb = new Set(b.split(/\s+/).filter((w) => w.length >= 3));
  if (!aa.size || !bb.size) return 0;
  let inter = 0;
  for (const w of aa) if (bb.has(w)) inter += 1;
  return inter / Math.max(aa.size, bb.size);
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

function isLiveMintItem(item: Record<string, string>): boolean {
  const blob = `${item.link || ""} ${item.source || ""} ${item.description || ""} ${item.title || ""}`;
  return LIVEMINT_ONLY.test(blob);
}

async function fetchLiveMintItems(): Promise<Array<Record<string, string>>> {
  const all = await Promise.all(LIVEMINT_FEEDS.map((u) => fetchRss(u)));
  const byLink = new Map<string, Record<string, string>>();
  for (const list of all) {
    for (const item of list || []) {
      if (!item?.title || !item?.link) continue;
      if (!isLiveMintItem(item)) continue;
      if (!byLink.has(item.link)) byLink.set(item.link, item);
    }
  }
  return Array.from(byLink.values());
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

    const body = (await req.json().catch(() => ({}))) as { city?: string; country?: string; force?: boolean };
    const city = normalizeLocation(body.city);
    const country = normalizeLocation(body.country);
    const forceRefresh = body.force === true;
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
    const shouldRefreshGlobal = forceRefresh || !existingGlobal?.created_at
      || (now - new Date(existingGlobal.created_at).getTime()) > NEWS_REFRESH_MS;
    const shouldRefreshLocal = !!city && !!country && (
      forceRefresh ||
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
      const globalRss = await fetchLiveMintItems();
      const fallbackGlobal: ParsedNews[] = [];
      for (const item of globalRss.slice(0, 12)) {
        if (!item.title || !item.link) continue;
        if (!isLiveMintItem(item)) continue;
        const bodyText = `${item.title}. ${item.description || ""}`;
        const cleanedTitle = stripSourceTail(stripUrlsAndDomains(stripHtml(item.title)));
        const fallbackSummary = buildSummary(cleanedTitle, stripHtml(bodyText), bodyText);
        fallbackGlobal.push({
          title: cleanedTitle,
          articleUrl: item.link,
          sourceName: "LiveMint",
          publishedAt: item.pubDate || new Date().toISOString(),
          summary: fallbackSummary,
          fullText: stripHtml(bodyText),
          imageUrl: null,
          industry: industryFromText(bodyText),
          scope: "global",
          city: null,
          country: null,
        });
        if (!isBusinessNews(bodyText, item.link)) continue;
        const fullText = await fetchArticleReadableText(item.link, stripHtml(bodyText));
        const summary = buildSummary(item.title || "", fullText, bodyText);
        if (!isBusinessNews(`${bodyText} ${fullText}`, item.link)) continue;
        if (isLowQualityStory(item.title || "", summary, fullText)) continue;
        allRows.push({
          title: stripSourceTail(stripUrlsAndDomains(stripHtml(item.title))),
          articleUrl: item.link,
          sourceName: "LiveMint",
          publishedAt: item.pubDate || new Date().toISOString(),
          summary,
          fullText,
          imageUrl: null,
          industry: industryFromText(bodyText),
          scope: "global",
          city: null,
          country: null,
        });
      }
      if (!allRows.length && fallbackGlobal.length) {
        allRows.push(...fallbackGlobal.slice(0, 6));
      }
    }

    if (shouldRefreshLocal) {
      const localRss = await fetchLiveMintItems();
      const fallbackLocal: ParsedNews[] = [];
      const localFiltered = localRss.filter((item) => {
        const blob = `${item.title || ""} ${item.description || ""}`.toLowerCase();
        return blob.includes(city) || blob.includes(country);
      });
      const localPool = localFiltered.length ? localFiltered : localRss;
      for (const item of localPool.slice(0, 10)) {
        if (!item.title || !item.link) continue;
        if (!isLiveMintItem(item)) continue;
        const bodyText = `${item.title}. ${item.description || ""}`;
        const cleanedTitle = stripSourceTail(stripUrlsAndDomains(stripHtml(item.title)));
        const fallbackSummary = buildSummary(cleanedTitle, stripHtml(bodyText), bodyText);
        fallbackLocal.push({
          title: cleanedTitle,
          articleUrl: item.link,
          sourceName: "LiveMint",
          publishedAt: item.pubDate || new Date().toISOString(),
          summary: fallbackSummary,
          fullText: stripHtml(bodyText),
          imageUrl: null,
          industry: industryFromText(bodyText),
          scope: "local",
          city,
          country,
        });
        if (!isBusinessNews(bodyText, item.link)) continue;
        const fullText = await fetchArticleReadableText(item.link, stripHtml(bodyText));
        const summary = buildSummary(item.title || "", fullText, bodyText);
        if (!isBusinessNews(`${bodyText} ${fullText}`, item.link)) continue;
        if (isLowQualityStory(item.title || "", summary, fullText)) continue;
        allRows.push({
          title: stripSourceTail(stripUrlsAndDomains(stripHtml(item.title))),
          articleUrl: item.link,
          sourceName: "LiveMint",
          publishedAt: item.pubDate || new Date().toISOString(),
          summary,
          fullText,
          imageUrl: null,
          industry: industryFromText(bodyText),
          scope: "local",
          city,
          country,
        });
      }
      if (!allRows.length && fallbackLocal.length) {
        allRows.push(...fallbackLocal.slice(0, 6));
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
      full_text: n.fullText || n.summary || n.title,
      source_name: n.sourceName,
      article_url: n.articleUrl,
      image_url: n.imageUrl,
      industry: n.industry,
      published_at: new Date(n.publishedAt).toISOString(),
      dedupe_hash: hashKey(`${n.scope}|${n.city || ""}|${n.country || ""}|${n.articleUrl}`),
    }));
    const byUrl = Array.from(new Map(payload.map((p) => [p.dedupe_hash, p])).values());
    const dedupedPayload: typeof byUrl = [];
    for (const row of byUrl) {
      const rowHeadline = normalizedHeadlineKey(row.title || "");
      const duplicate = dedupedPayload.find((x) => {
        if (x.scope !== row.scope) return false;
        if ((x.city || "") !== (row.city || "")) return false;
        if ((x.country || "") !== (row.country || "")) return false;
        const xHeadline = normalizedHeadlineKey(x.title || "");
        return headlineSimilarity(xHeadline, rowHeadline) >= 0.72;
      });
      if (!duplicate) dedupedPayload.push(row);
    }
    const fallbackPool = byUrl.filter((row) => {
      const rowHeadline = normalizedHeadlineKey(row.title || "");
      const duplicate = dedupedPayload.find((x) => {
        if (x.scope !== row.scope) return false;
        if ((x.city || "") !== (row.city || "")) return false;
        if ((x.country || "") !== (row.country || "")) return false;
        const xHeadline = normalizedHeadlineKey(x.title || "");
        return headlineSimilarity(xHeadline, rowHeadline) >= 0.72;
      });
      return !duplicate;
    });
    for (const extra of fallbackPool) {
      if (dedupedPayload.length >= MIN_NEWS_CARDS) break;
      dedupedPayload.push(extra);
    }

    const globalRows = dedupedPayload.filter((p) => p.scope === "global");
    const localRows = dedupedPayload.filter((p) => p.scope === "local");

    if (globalRows.length > 0) {
      const { error: delGlobalErr } = await admin.from("news_cards").delete().eq("scope", "global");
      if (delGlobalErr) {
        return new Response(JSON.stringify({ error: delGlobalErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { error: insGlobalErr } = await admin
        .from("news_cards")
        .upsert(globalRows, { onConflict: "dedupe_hash", ignoreDuplicates: false });
      if (insGlobalErr) {
        return new Response(JSON.stringify({ error: insGlobalErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (localRows.length > 0) {
      const localKeys = Array.from(
        new Set(localRows.map((r) => `${r.city || ""}|${r.country || ""}`)),
      );
      for (const key of localKeys) {
        const [c, k] = key.split("|");
        const { error: delLocalErr } = await admin
          .from("news_cards")
          .delete()
          .eq("scope", "local")
          .eq("city", c || "")
          .eq("country", k || "");
        if (delLocalErr) {
          return new Response(JSON.stringify({ error: delLocalErr.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      const { error: insLocalErr } = await admin
        .from("news_cards")
        .upsert(localRows, { onConflict: "dedupe_hash", ignoreDuplicates: false });
      if (insLocalErr) {
        return new Response(JSON.stringify({ error: insLocalErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ ok: true, refreshed: true, inserted: dedupedPayload.length, key: localKey }), {
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
