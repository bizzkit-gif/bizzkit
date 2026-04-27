import React, { useState, useEffect, useMemo } from 'react'
import { sb, SUPABASE_ANON_KEY, SUPABASE_URL, Business, INDUSTRIES, grad, fmtDate, fetchBusinessProfilesByIds, otherConnectionBusinessId, otherChatParticipantId, normalizeUuid, deleteConnectionBetween } from '../lib/db'
import { useApp } from '../context/ctx'

/** Narrow columns + product fields — faster than `*,products(*)`. */
const FEED_BUSINESS_SELECT =
  'id,name,tagline,industry,city,country,type,logo,logo_url,kyc_verified,trust_score,products(id,name,emoji,price,category)'

const FEED_CACHE_PREFIX = 'bizzkit.feed.v2.'
const FEED_CACHE_MS = 120_000

type NewsCard = {
  id: string
  scope: 'global' | 'local'
  city: string | null
  country: string | null
  title: string
  summary: string
  full_text: string
  source_name: string
  article_url: string
  image_url: string | null
  industry: string
  published_at: string
}

type FeedMixedItem =
  | { id: string; type: 'post'; createdAt: string; post: { id: string; business_id: string; content: string; media_url: string | null; media_type: string | null; created_at: string } }
  | { id: string; type: 'news'; createdAt: string; news: NewsCard }
  | { id: string; type: 'suggested'; createdAt: string; businessIds: string[] }

const normalizeLogoImage = (value?: string | null): string | null => {
  if (!value) return null
  let v = value.trim()
  if (!v) return null
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1).trim()
  if (!v) return null
  if (v.startsWith('data:')) return v
  if (v.startsWith('http://') || v.startsWith('https://') || v.startsWith('/')) return v
  if (/^[A-Za-z0-9+/=]+$/.test(v) && v.length > 120) return `data:image/jpeg;base64,${v}`
  return null
}

const logoInitials = (name?: string) => (name || '').split(' ').slice(0,2).map(w => w[0] || '').join('').toUpperCase() || 'BK'
const cleanDisplayText = (value?: string | null): string => {
  const v = (value || '').trim()
  if (!v) return ''
  // Remove accidental raw/base64 payloads leaking into UI labels.
  return v.replace(/[A-Za-z0-9+/=]{40,}/g, '').trim()
}

/** Concatenate searchable fields (name-only search missed tagline/city/products and threw on null name). */
function businessSearchBlob(b: Business): string {
  return [
    b.name,
    b.tagline,
    b.industry,
    b.city,
    b.country,
    b.type,
    ...(b.products?.flatMap((p) => [p.name, p.price, p.category, p.emoji]) ?? []),
  ]
    .filter((x): x is string => typeof x === 'string')
    .join(' ')
}

/** Every whitespace-separated term must appear as a substring (case-insensitive). */
function matchesSearchText(haystack: string, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase()
  if (!q) return true
  const h = haystack.toLowerCase()
  return q.split(/\s+/).filter(Boolean).every((term) => h.includes(term))
}

function isBusinessNewsCard(n: NewsCard): boolean {
  const liveMintOnly = /livemint\.com/i.test(n.article_url || '') || /livemint/i.test(n.source_name || '')
  if (!liveMintOnly) return false
  const businessUrlPath = /\/(companies|markets|industry|money|economy|companies\/news|market\/stock-market-news)\//i.test(n.article_url || '')
  const businessText = /(business|economy|economic|market|startup|funding|finance|bank|stock|ipo|industry|manufactur|retail|company|companies|trade|investment|investor|merger|acquisition|supply chain|logistics|b2b|enterprise|earnings|revenue|profit|fiscal|quarter|q1|q2|q3|q4|shareholder|valuation|capital|debt|credit|inflation|gdp|exports|imports)/i.test(`${n.title} ${n.summary} ${n.full_text || ''}`)
  if (!(businessUrlPath || businessText)) return false
  const nonBusinessPolitics = /(pope|church|vatican|migrant|immigration|racist|racism|israel|iran|gaza|hamas|war|missile|airstrike|ceasefire|election|vote|campaign|parliament|congress|senate|prime minister|president|trump|biden|putin|zelensky|protest|riot)/i.test(`${n.title} ${n.summary} ${n.full_text || ''}`)
  if (nonBusinessPolitics) return false
  const text = `${n.title} ${n.summary} ${n.full_text || ''}`.toLowerCase()
  const bad = /(weather|storm|rainfall|snow|hurricane|cyclone|thunderstorm|heatwave|temperature|forecast|climate alert|air quality|pollen|wildfire|earthquake|flood warning|russia|russian|moscow|kremlin|putin|россия|русск|москва|кремл|путин|[\u0400-\u04FF])/
  if (bad.test(text)) return false
  const title = stripNewsSourceNoise(n.title).toLowerCase()
  const summary = stripNewsSourceNoise(n.summary).toLowerCase()
  if (!title) return false
  if (!summary) return true
  const repeatedHeadline = summary.split(title).length - 1 >= 4
  if (repeatedHeadline) return false
  return true
}

function stripNewsSourceNoise(text: string): string {
  return (text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b(?:www\.)?[a-z0-9-]+\.(?:com|in|net|org|co|io|biz|info|news|tv|uk|me|ai)(?:\/\S*)?\b/gi, ' ')
    .replace(/\s[-|:]\s*[A-Za-z0-9 .,&'-]{2,40}$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeNewsHeadlineKey(text: string): string {
  return stripNewsSourceNoise(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(the|a|an|to|for|of|in|on|at|with|from|by|and)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 14)
    .join(' ')
}

function headlineLike(line: string, headline: string): boolean {
  const l = stripNewsSourceNoise(line).toLowerCase()
  const h = stripNewsSourceNoise(headline).toLowerCase()
  if (!l || !h) return false
  if (l === h) return true
  if (l.includes(h) || h.includes(l)) return true
  const titleTokens = h.split(/\s+/).filter((w) => w.length > 3)
  if (!titleTokens.length) return false
  const overlap = titleTokens.filter((t) => l.includes(t)).length / titleTokens.length
  return overlap >= 0.75
}

function buildDisplaySummary(n: NewsCard): string {
  const headline = stripNewsSourceNoise(n.title)
  const cleanedSummary = stripNewsSourceNoise(n.summary)
  const cleanedFull = stripNewsSourceNoise(n.full_text || '')
  const summaryLooksBad =
    !cleanedSummary ||
    cleanedSummary.length < 120 ||
    headlineLike(cleanedSummary, headline)

  if (!summaryLooksBad) return cleanedSummary.slice(0, 1800)

  const base = cleanedFull || cleanedSummary || headline
  const sentences = base
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40 && s.length <= 300)
    .filter((s) => !/(subscribe|newsletter|all rights reserved|copyright|read more|watch live)/i.test(s))
    .filter((s) => !headlineLike(s, headline))

  const selected: string[] = []
  let len = 0
  for (const s of sentences) {
    const nextLen = len + s.length + (selected.length ? 1 : 0)
    if (nextLen > 1800) break // roughly max 25 lines in modal
    selected.push(s)
    len = nextLen
    if (selected.length >= 12) break
  }

  return (selected.join(' ') || base).trim().slice(0, 1800)
}

function splitSentences(text: string): string[] {
  return (text || '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function buildInShortsWriteup(n: NewsCard, maxChars: number): string {
  const headline = stripNewsSourceNoise(n.title)
  const base = buildDisplaySummary(n)
  const sentences = splitSentences(base)
    .filter((s) => s.length >= 30)
    .filter((s) => !headlineLike(s, headline))
    .filter((s) => !/(subscribe|newsletter|all rights reserved|copyright|read more|click here|watch live)/i.test(s))

  const selected: string[] = []
  let total = 0
  for (const s of sentences) {
    const next = total + s.length + (selected.length ? 1 : 0)
    if (next > maxChars) break
    selected.push(s)
    total = next
    if (selected.length >= 8) break
  }

  const text = (selected.join(' ') || base || '').trim()
  if (!text) return ''
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function buildNewsTeaserOneLiner(n: NewsCard): string {
  const longForm = buildInShortsWriteup(n, 420)
  const firstSentence = (longForm.split(/(?<=[.!?])\s+/).find((s) => s.trim().length > 0) || longForm).trim()
  const oneLine = firstSentence.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= 120) return oneLine
  return `${oneLine.slice(0, 117).trimEnd()}...`
}

export default function FeedPage({ onView }: { onView: (id: string) => void }) {
  const { myBiz, user, toast, setTab, unread, pendingRandomCallFromBusinessId, pendingChatCallFromBusinessId } = useApp()
  const [list, setList] = useState<Business[]>([])
  const [feedView, setFeedView] = useState<'feed'|'explore'|'connected'>('feed')
  const [filter, setFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [saved, setSaved] = useState<Set<string>>(new Set())
  /** Chat partners + formal connections — drives connection-post feed & discover exclusions. */
  const [conns, setConns] = useState<Set<string>>(new Set())
  /** Formal `connections` rows only — drives Connect / Disconnect / Connected tab (matches Profile). */
  const [linkedBizIds, setLinkedBizIds] = useState<Set<string>>(new Set())
  const [connectionPosts, setConnectionPosts] = useState<Array<{
    id: string
    business_id: string
    content: string
    media_url: string | null
    media_type: string | null
    created_at: string
  }>>([])
  const [newsCards, setNewsCards] = useState<NewsCard[]>([])
  const [openNewsletterNewsId, setOpenNewsletterNewsId] = useState<string | null>(null)
  const [readMoreSummary, setReadMoreSummary] = useState<string>('')
  const [readMoreLoading, setReadMoreLoading] = useState(false)
  const [likesByPostId, setLikesByPostId] = useState<Record<string, number>>({})
  const [likedPostIds, setLikedPostIds] = useState<Set<string>>(new Set())
  const [likingPostIds, setLikingPostIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  /** Same source as bottom-nav Chat badge: updates on Realtime (includes Random call invite messages). */
  const bellBadgeCount = Math.max(unread, pendingRandomCallFromBusinessId ? 1 : 0, pendingChatCallFromBusinessId ? 1 : 0)

  useEffect(() => {
    let active = true
    const loadFeedData = async () => {
      let ownBizId = myBiz?.id || null
      if (!ownBizId && user?.id) {
        const { data: ownBiz } = await sb.from('businesses').select('id').eq('owner_id', user.id).single()
        ownBizId = ownBiz?.id || null
      }

      const cacheKey = `${FEED_CACHE_PREFIX}${user?.id ?? 'anon'}:${ownBizId ?? 'none'}`
      let usedCache = false
      try {
        const raw = sessionStorage.getItem(cacheKey)
        if (raw) {
          const parsed = JSON.parse(raw) as { t: number; rows: Business[] }
          if (Date.now() - parsed.t < FEED_CACHE_MS && parsed.rows?.length && active) {
            setList(parsed.rows)
            usedCache = true
            setLoading(false)
          }
        }
      } catch {
        /* ignore */
      }
      if (!usedCache) setLoading(true)

      const [businessesRes, { data: savedRows }, connsRes, chatsRes] = await Promise.all([
        sb.from('businesses').select(FEED_BUSINESS_SELECT).order('trust_score', { ascending: false }),
        user?.id ? sb.from('saved_businesses').select('business_id').eq('user_id', user.id) : Promise.resolve({ data: [] as any[] }),
        ownBizId ? sb.from('connections').select('from_biz_id,to_biz_id').or(`from_biz_id.eq.${ownBizId},to_biz_id.eq.${ownBizId}`) : Promise.resolve({ data: [] as any[] }),
        ownBizId ? sb.from('chats').select('participant_a,participant_b').or(`participant_a.eq.${ownBizId},participant_b.eq.${ownBizId}`) : Promise.resolve({ data: [] as any[] })
      ])
      let businesses = (businessesRes.data || []) as Business[]
      const { data: sessData } = await sb.auth.getSession()
      const token = sessData.session?.access_token || ''
      if (token) {
        const fallbackRes = await fetch(`${SUPABASE_URL}/functions/v1/list-feed-businesses`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        })
        if (fallbackRes.ok) {
          const body = (await fallbackRes.json().catch(() => ({}))) as { rows?: Business[] }
          businesses = (body.rows || []) as Business[]
        }
      } else if (!businesses.length || !!businessesRes.error) {
        businesses = []
      }

      if (!active) return
      const linkedIds = new Set<string>()
      ;((connsRes.data as any[]) || []).forEach((c: any) => {
        if (!ownBizId) return
        const otherId = otherConnectionBusinessId(
          { from_biz_id: c.from_biz_id, to_biz_id: c.to_biz_id },
          ownBizId,
        )
        if (otherId && normalizeUuid(otherId) !== normalizeUuid(ownBizId)) linkedIds.add(normalizeUuid(otherId))
      })
      const mergedPeerIds = new Set<string>(linkedIds)
      ;((chatsRes.data as any[]) || []).forEach((c: any) => {
        if (!ownBizId) return
        const otherId = otherChatParticipantId(
          { participant_a: c.participant_a, participant_b: c.participant_b },
          ownBizId,
        )
        if (otherId && normalizeUuid(otherId) !== normalizeUuid(ownBizId)) mergedPeerIds.add(normalizeUuid(otherId))
      })
      let nextList = (businesses || []).filter(
        (b) => normalizeUuid(b.id) !== normalizeUuid(ownBizId || ''),
      ) as Business[]
      const inFeed = new Set(nextList.map((b) => normalizeUuid(b.id)))
      const missingConn = [...mergedPeerIds].filter((id) => id && !inFeed.has(id))
      if (missingConn.length) {
        const extra = await fetchBusinessProfilesByIds(FEED_BUSINESS_SELECT, missingConn)
        nextList = [...nextList, ...extra.filter((b) => normalizeUuid(b.id) !== normalizeUuid(ownBizId || ''))]
      }
      setList(nextList)
      setSaved(new Set((savedRows || []).map((s: any) => s.business_id)))
      setLinkedBizIds(linkedIds)
      setConns(mergedPeerIds)
      setLoading(false)
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), rows: nextList }))
      } catch {
        /* quota / private mode */
      }
    }

    loadFeedData()
    return () => { active = false }
  }, [myBiz?.id, user?.id])

  const connKey = Array.from(conns).sort().join(',')

  useEffect(() => {
    if (!myBiz) {
      setConnectionPosts([])
      return
    }
    const fromConns = connKey ? connKey.split(',').filter(Boolean) : []
    const ids = Array.from(new Set([myBiz.id, ...fromConns]))
    sb.from('posts')
      .select('id,business_id,content,media_url,media_type,created_at')
      .in('business_id', ids)
      .order('created_at', { ascending: false })
      .limit(80)
      .then(({ data }) => setConnectionPosts((data as typeof connectionPosts) || []))
  }, [connKey, myBiz?.id])

  useEffect(() => {
    let active = true
    const loadNews = async () => {
      const city = (myBiz?.city || '').trim().toLowerCase()
      const country = (myBiz?.country || '').trim().toLowerCase()
      const { data: sessData } = await sb.auth.getSession()
      const token = sessData.session?.access_token || ''
      // Refresh in background — cron also updates news; never block paint on RSS/scrape latency.
      if (token) {
        void fetch(`${SUPABASE_URL}/functions/v1/news-agent-refresh`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ city, country }),
        }).catch(() => undefined)
      }

      const newsSelect =
        'id,scope,city,country,title,summary,full_text,source_name,article_url,image_url,industry,published_at' as const
      const globalQ = sb
        .from('news_cards')
        .select(newsSelect)
        .eq('scope', 'global')
        .order('published_at', { ascending: false })
        .limit(20)
      const localQ =
        city && country
          ? sb
              .from('news_cards')
              .select(newsSelect)
              .eq('scope', 'local')
              .eq('city', city)
              .eq('country', country)
              .order('published_at', { ascending: false })
              .limit(20)
          : Promise.resolve({ data: [] as NewsCard[] })

      const [{ data: globalRows }, { data: localData }] = await Promise.all([globalQ, localQ])
      const localRows = localData ?? []

      if (!active) return
      const map = new Map<string, NewsCard>()
      ;((globalRows as NewsCard[]) || []).forEach((n) => map.set(n.id, n))
      localRows.forEach((n) => map.set(n.id, n))
      const uniqueByHeadline = new Map<string, NewsCard>()
      Array.from(map.values()).forEach((n) => {
        const key = normalizeNewsHeadlineKey(n.title)
        uniqueByHeadline.set(key, n)
      })
      const merged = Array.from(uniqueByHeadline.values())
        .filter((n) => isBusinessNewsCard(n))
        .sort(
        (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime(),
      )
      setNewsCards(merged)
    }

    void loadNews()
    return () => {
      active = false
    }
  }, [myBiz?.city, myBiz?.country, user?.id])

  const feedPostIdsKey = useMemo(
    () => connectionPosts.map((p) => p.id).sort().join(','),
    [connectionPosts],
  )

  useEffect(() => {
    if (!feedPostIdsKey) {
      setLikesByPostId({})
      setLikedPostIds(new Set())
      return
    }
    const postIds = connectionPosts.map((p) => p.id)
    let cancelled = false
    const CHUNK = 100
    void (async () => {
      const counts: Record<string, number> = {}
      for (let i = 0; i < postIds.length; i += CHUNK) {
        const chunk = postIds.slice(i, i + CHUNK)
        const { data: likeRows } = await sb.from('post_likes').select('post_id').in('post_id', chunk)
        for (const r of likeRows || []) {
          const pid = (r as { post_id: string }).post_id
          counts[pid] = (counts[pid] || 0) + 1
        }
      }
      if (cancelled) return
      setLikesByPostId(counts)
      if (!myBiz) {
        setLikedPostIds(new Set())
        return
      }
      const mine = new Set<string>()
      for (let i = 0; i < postIds.length; i += CHUNK) {
        const chunk = postIds.slice(i, i + CHUNK)
        const { data: likedRows } = await sb
          .from('post_likes')
          .select('post_id')
          .eq('business_id', myBiz.id)
          .in('post_id', chunk)
        for (const r of likedRows || []) {
          mine.add((r as { post_id: string }).post_id)
        }
      }
      if (!cancelled) setLikedPostIds(mine)
    })()
    return () => {
      cancelled = true
    }
  }, [feedPostIdsKey, myBiz?.id])

  const openNotifications = () => {
    if (unread > 0) {
      toast(`You have ${unread} unread message${unread > 1 ? 's' : ''}`, 'info')
      setTab('messages')
      return
    }
    if (pendingChatCallFromBusinessId) {
      toast('Incoming Chat call — open Chat to answer', 'info')
      setTab('messages')
      return
    }
    if (pendingRandomCallFromBusinessId) {
      toast('Incoming Random call — open Random to answer', 'info')
      setTab('random')
      return
    }
    toast('No new notifications', 'info')
  }

  const discoverBase = list.filter((b) => !conns.has(normalizeUuid(b.id)))
  const exploreBase = list
  const connectedBase = list.filter((b) => linkedBizIds.has(normalizeUuid(b.id)))
  const source = feedView === 'connected' ? connectedBase : feedView === 'explore' ? exploreBase : []

  const items = source.filter((b) => {
    const mf = filter === 'All' || b.industry === filter
    const ms = matchesSearchText(businessSearchBlob(b), search)
    return mf && ms
  })

  const trending = exploreBase.filter((b) => {
    const mf = filter === 'All' || b.industry === filter
    const ms = matchesSearchText(businessSearchBlob(b), search)
    return mf && ms && b.trust_score >= 70
  }).slice(0, 4)

  const bizById = new Map<string, Business>(list.map((b) => [normalizeUuid(b.id), b] as const))
  if (myBiz) bizById.set(normalizeUuid(myBiz.id), myBiz)
  const connectionFeedPosts = connectionPosts.filter((p) => {
    const b = bizById.get(normalizeUuid(p.business_id))
    const industryOk = !b || filter === 'All' || b.industry === filter
    const blob = b ? `${businessSearchBlob(b)} ${p.content || ''}` : (p.content || '')
    const textMatch = matchesSearchText(blob, search)
    return industryOk && textMatch
  })
  const suggestedConnections = discoverBase
    .filter((b) => {
      const mf = filter === 'All' || b.industry === filter
      const ms = matchesSearchText(businessSearchBlob(b), search)
      return mf && ms
    })
    .slice(0, 3)

  const mixedFeedItems = useMemo<FeedMixedItem[]>(() => {
    const postItems: FeedMixedItem[] = connectionFeedPosts.map((post) => ({
      id: `post:${post.id}`,
      type: 'post',
      createdAt: post.created_at,
      post,
    }))
    const newsItems: FeedMixedItem[] = newsCards
      .filter((news) => {
        const filterOk = filter === 'All' || news.industry === filter
        const textOk = matchesSearchText(`${news.title} ${news.summary} ${news.source_name}`, search)
        return filterOk && textOk
      })
      .map((news) => ({
        id: `news:${news.id}`,
        type: 'news',
        createdAt: news.published_at,
        news,
      }))

    const mixed = [...postItems, ...newsItems].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    if (!search.trim()) {
      const suggestedItem: FeedMixedItem = {
        id: `suggested:${suggestedConnections.map((b) => b.id).join(',') || 'empty'}`,
        type: 'suggested',
        createdAt: new Date(Date.now() - 1).toISOString(),
        businessIds: suggestedConnections.map((b) => b.id),
      }
      mixed.splice(Math.min(2, mixed.length), 0, suggestedItem)
    }
    return mixed
  }, [connectionFeedPosts, newsCards, filter, search, suggestedConnections])

  const openNewsletterNews = useMemo(
    () => newsCards.find((n) => n.id === openNewsletterNewsId) || null,
    [newsCards, openNewsletterNewsId],
  )
  const openNewsletterSummary = useMemo(() => {
    if (!openNewsletterNews) return ''
    if (readMoreSummary.trim()) {
      return buildInShortsWriteup({ ...openNewsletterNews, summary: readMoreSummary }, 2200)
    }
    return buildInShortsWriteup(openNewsletterNews, 2200)
  }, [openNewsletterNews, readMoreSummary])

  const onReadMoreNews = async (n: NewsCard) => {
    setOpenNewsletterNewsId(n.id)
    setReadMoreSummary('')
    setReadMoreLoading(true)
    try {
      const { data: sessData } = await sb.auth.getSession()
      const token = sessData.session?.access_token || ''
      if (!token) {
        setReadMoreSummary(buildDisplaySummary(n))
        return
      }
      const res = await fetch(`${SUPABASE_URL}/functions/v1/news-read-more-summary`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          headline: n.title,
          articleUrl: n.article_url,
          fallbackText: n.full_text || n.summary,
        }),
      })
      if (!res.ok) {
        setReadMoreSummary(buildDisplaySummary(n))
        return
      }
      const body = (await res.json().catch(() => ({}))) as { summary?: string }
      setReadMoreSummary((body.summary || '').trim() || buildDisplaySummary(n))
    } catch {
      setReadMoreSummary(buildDisplaySummary(n))
    } finally {
      setReadMoreLoading(false)
    }
  }
  const onLikeFeedPost = async (postId: string) => {
    if (!myBiz) {
      toast('Create a business profile first', 'info')
      return
    }
    if (likedPostIds.has(postId)) {
      toast('You already liked this post', 'info')
      return
    }
    if (likingPostIds.has(postId)) return
    setLikingPostIds((prev) => new Set([...prev, postId]))
    const { error } = await sb.from('post_likes').insert({ post_id: postId, business_id: myBiz.id })
    setLikingPostIds((prev) => {
      const next = new Set(prev)
      next.delete(postId)
      return next
    })
    if (error) {
      if (error.message.toLowerCase().includes('duplicate')) {
        setLikedPostIds((prev) => new Set([...prev, postId]))
        toast('You already liked this post', 'info')
        return
      }
      toast('Failed to like post: ' + error.message, 'error')
      return
    }
    setLikedPostIds((prev) => new Set([...prev, postId]))
    setLikesByPostId((prev) => ({ ...prev, [postId]: (prev[postId] || 0) + 1 }))
  }

  const doSave = async (b: Business) => {
    if (!user) { toast('Sign in to save', 'info'); return }
    if (saved.has(b.id)) {
      await sb.from('saved_businesses').delete().eq('user_id', user.id).eq('business_id', b.id)
      setSaved(s => { const n = new Set(s); n.delete(b.id); return n })
      toast('Removed from saved')
    } else {
      await sb.from('saved_businesses').insert({ user_id: user.id, business_id: b.id })
      setSaved(s => new Set([...s, b.id]))
      toast('Saved!')
    }
  }

  const doConnect = async (b: Business) => {
    if (!myBiz) { toast('Create a business profile first', 'info'); return }
    const peer = normalizeUuid(b.id)
    if (linkedBizIds.has(peer)) {
      const r = await deleteConnectionBetween(myBiz.id, b.id)
      if (r.ok === false) { toast('Failed to disconnect: ' + r.error, 'error'); return }
      setLinkedBizIds((s) => {
        const next = new Set(s)
        next.delete(peer)
        return next
      })
      setConns((s) => {
        const next = new Set(s)
        next.delete(peer)
        return next
      })
      toast('Disconnected from ' + b.name)
      return
    }
    const { error: connErr } = await sb.from('connections').insert({ from_biz_id: myBiz.id, to_biz_id: b.id })
    if (connErr) {
      const msg = (connErr.message || '').toLowerCase()
      if (msg.includes('duplicate') || msg.includes('unique')) {
        setLinkedBizIds((s) => new Set([...s, peer]))
        setConns((s) => new Set([...s, peer]))
        toast('Already connected with ' + b.name, 'info')
        return
      }
      toast('Failed to connect: ' + connErr.message, 'error')
      return
    }
    const { error: chatErr } = await sb.rpc('get_or_create_chat', { biz_a: myBiz.id, biz_b: b.id })
    if (chatErr) { toast('Connected, but chat setup failed', 'info') }
    setLinkedBizIds((s) => new Set([...s, peer]))
    setConns((s) => new Set([...s, peer]))
    toast('Connected with ' + b.name + '!')
  }

  return (
    <div style={{ paddingBottom:16 }}>
      <div className="topbar">
        <div className="logo-txt">bizz<span>kit</span></div>
        <div style={{ position:'relative' }}>
          <div className="icon-btn" onClick={openNotifications}>🔔</div>
          {bellBadgeCount > 0 && (
            <div style={{ position:'absolute', top:-4, right:-4, minWidth:18, height:18, borderRadius:9, background:'#FF4B6E', color:'#fff', fontSize:10, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', padding:'0 5px' }}>
              {bellBadgeCount > 9 ? '9+' : bellBadgeCount}
            </div>
          )}
        </div>
      </div>

      <div className="search-wrap">
        <span style={{ fontSize:15, color:'#7A92B0' }}>🔍</span>
        <input
          placeholder={
            feedView === 'feed' ? 'Search posts…' :
            feedView === 'connected' ? 'Search connected businesses…' :
            'Search businesses…'
          }
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && <span style={{ cursor:'pointer', color:'#7A92B0', fontSize:18 }} onClick={() => setSearch('')}>×</span>}
      </div>

      <div style={{ margin:'0 16px 12px', display:'flex', background:'#152236', borderRadius:12, padding:4, border:'1px solid rgba(255,255,255,0.07)', gap:2 }}>
        {([
          { id:'feed' as const, label:'Home' },
          { id:'explore' as const, label:'Explore' },
          { id:'connected' as const, label:'Connected' }
        ]).map(v => (
          <button
            key={v.id}
            type="button"
            title={v.id === 'explore' ? 'Explore businesses' : v.id === 'connected' ? 'Connected businesses' : 'Home'}
            onClick={() => setFeedView(v.id)}
            style={{
              flex:1,
              border:'none',
              borderRadius:9,
              padding:'8px 6px',
              cursor:'pointer',
              background:feedView===v.id?'#1E7EF7':'transparent',
              color:feedView===v.id?'#fff':'#7A92B0',
              fontSize:10.5,
              fontWeight:700,
              lineHeight:1.2
            }}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="chips">
        {['All', ...INDUSTRIES.slice(0,6)].map(i => (
          <div key={i} className={`chip${filter===i?' on':''}`} onClick={() => setFilter(i)}>{i}</div>
        ))}
      </div>

      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', padding:'40px 0' }}><div className="spinner" /></div>
      ) : (
        <>
          {feedView === 'feed' && (
            <>
              <div className="sec-hd"><h3>Home feed</h3><span className="see-all">{mixedFeedItems.length} items</span></div>
              {mixedFeedItems.length === 0 ? (
                <div style={{ margin:'0 16px 14px', padding:'16px', background:'#152236', borderRadius:14, border:'1px solid rgba(255,255,255,0.07)', fontSize:12.5, color:'#7A92B0', textAlign:'center' }}>
                  No feed items yet. Create your business profile to see connection posts. Business news cards are fetched automatically.
                </div>
              ) : (
                <div style={{ padding:'0 16px', marginBottom:14 }}>
                  {mixedFeedItems.map(item => {
                    if (item.type === 'post') {
                      const p = item.post
                      const b = bizById.get(normalizeUuid(p.business_id))
                      const isOwn = myBiz ? normalizeUuid(p.business_id) === normalizeUuid(myBiz.id) : false
                      const bizName = b ? cleanDisplayText(b.name) || 'Business' : 'Business'
                      const logoSrc = b ? (normalizeLogoImage(b.logo) || normalizeLogoImage(b.logo_url)) : null
                      return (
                        <div key={item.id} style={{ background:'#152236', borderRadius:14, padding:13, border:`1px solid ${isOwn ? 'rgba(30,126,247,0.35)' : 'rgba(255,255,255,0.07)'}`, marginBottom:10 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:9, marginBottom:8 }}>
                            <div className={grad(p.business_id)} onClick={() => onView(p.business_id)} style={{ width:36, height:36, borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:12, color:'#fff', flexShrink:0, cursor:'pointer', overflow:'hidden' }}>
                              {logoSrc ? <img src={logoSrc} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' as const }} /> : logoInitials(bizName)}
                            </div>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                                <div style={{ fontFamily:'Syne, sans-serif', fontSize:13, fontWeight:700, cursor:'pointer' }} onClick={() => onView(p.business_id)}>{bizName}</div>
                                {isOwn && <span style={{ fontSize:9, fontWeight:800, background:'#1E7EF7', color:'#fff', padding:'2px 6px', borderRadius:5 }}>You</span>}
                              </div>
                              <div style={{ fontSize:10, color:'#7A92B0' }}>{fmtDate(p.created_at)}</div>
                            </div>
                          </div>
                          {p.content ? <p style={{ fontSize:13, color:'#fff', lineHeight:1.55, margin:0 }}>{p.content}</p> : null}
                          {p.media_url && (p.media_type === 'video' ? (
                            <video src={p.media_url} controls style={{ width:'100%', borderRadius:10, maxHeight:240, marginTop:10, objectFit:'cover' as const }} />
                          ) : (
                            <img src={p.media_url} alt="" style={{ width:'100%', borderRadius:10, maxHeight:240, marginTop:10, objectFit:'cover' as const }} />
                          ))}
                          <div style={{ display:'flex', gap:8, marginTop:10, paddingTop:8, borderTop:'1px solid rgba(255,255,255,0.07)' }}>
                            <button
                              type="button"
                              onClick={() => onLikeFeedPost(p.id)}
                              disabled={likedPostIds.has(p.id) || likingPostIds.has(p.id)}
                              style={{
                                flex:1,
                                padding:'6px 0',
                                background: likedPostIds.has(p.id) ? 'rgba(30,126,247,0.2)' : '#0A1628',
                                border:'1px solid rgba(255,255,255,0.07)',
                                borderRadius:9,
                                color: likedPostIds.has(p.id) ? '#1E7EF7' : '#7A92B0',
                                fontSize:12,
                                fontWeight:600,
                                cursor: likedPostIds.has(p.id) ? 'default' : 'pointer',
                              }}
                            >
                              {likedPostIds.has(p.id) ? 'Liked' : likingPostIds.has(p.id) ? 'Liking…' : 'Like'} {likesByPostId[p.id] ?? 0}
                            </button>
                          </div>
                        </div>
                      )
                    }

                    if (item.type === 'suggested') {
                      const suggestedBiz = item.businessIds
                        .map((id) => bizById.get(normalizeUuid(id)))
                        .filter((b): b is Business => !!b)
                      return (
                        <div key={item.id} style={{ background:'#152236', borderRadius:14, padding:13, border:'1px solid rgba(255,255,255,0.1)', marginBottom:10 }}>
                          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, marginBottom:10 }}>
                            <h4 style={{ margin:0, fontSize:13.5, fontFamily:'Syne, sans-serif' }}>Suggested Connections</h4>
                            <span style={{ fontSize:10, color:'#7A92B0' }}>Based on your feed</span>
                          </div>
                          {suggestedBiz.length > 0 ? (
                            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                              {suggestedBiz.map((b) => {
                                const isConn = linkedBizIds.has(normalizeUuid(b.id))
                                const logoSrc = normalizeLogoImage(b.logo) || normalizeLogoImage(b.logo_url)
                                const bizName = cleanDisplayText(b.name) || 'Business'
                                return (
                                  <div key={b.id} style={{ display:'flex', alignItems:'center', gap:8, background:'#0F1D31', borderRadius:10, padding:8, border:'1px solid rgba(255,255,255,0.06)' }}>
                                    <div className={grad(b.id)} onClick={() => onView(b.id)} style={{ width:34, height:34, borderRadius:9, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:11, color:'#fff', flexShrink:0, cursor:'pointer', overflow:'hidden' }}>
                                      {logoSrc ? <img src={logoSrc} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' as const }} /> : logoInitials(bizName)}
                                    </div>
                                    <div style={{ flex:1, minWidth:0, cursor:'pointer' }} onClick={() => onView(b.id)}>
                                      <div style={{ fontSize:12.5, fontWeight:700 }}>{bizName}</div>
                                      <div style={{ fontSize:10, color:'#7A92B0' }}>{cleanDisplayText(b.industry)} · {cleanDisplayText(b.city)}</div>
                                    </div>
                                    <button onClick={() => doConnect(b)} className={`btn btn-sm ${isConn?'btn-ghost':'btn-blue'}`} style={{ flexShrink:0 }}>
                                      {isConn ? 'Disconnect' : 'Connect'}
                                    </button>
                                  </div>
                                )
                              })}
                            </div>
                          ) : (
                            <div style={{ background:'#0F1D31', borderRadius:10, padding:'10px 11px', border:'1px solid rgba(255,255,255,0.06)', fontSize:12, color:'#9FB2C8' }}>
                              No new suggestions right now. Explore more businesses to discover new connections.
                            </div>
                          )}
                        </div>
                      )
                    }

                    const n = item.news
                    const cardSummary = buildNewsTeaserOneLiner(n)
                    return (
                      <div key={item.id} style={{ background:'#152236', borderRadius:14, padding:13, border:'1px solid rgba(85,170,255,0.35)', marginBottom:10 }}>
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, marginBottom:8 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                            <span style={{ fontSize:11, fontWeight:800, background:'#1E7EF7', color:'#fff', padding:'3px 7px', borderRadius:6 }}>News</span>
                            <span style={{ fontSize:10, color:'#7A92B0' }}>{n.scope === 'local' ? 'Local' : 'Global'} · {n.source_name}</span>
                          </div>
                          <div style={{ fontSize:10, color:'#7A92B0' }}>{fmtDate(n.published_at)}</div>
                        </div>
                        <h4 style={{ margin:'0 0 6px', fontSize:14, lineHeight:1.35 }}>{stripNewsSourceNoise(n.title)}</h4>
                        <p style={{ margin:'0 0 10px', fontSize:12.8, color:'#C9D6E5', lineHeight:1.5 }}>{cardSummary}</p>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
                          <span style={{ fontSize:10, color:'#7A92B0' }}>Industry: {n.industry}</span>
                          <button
                            type="button"
                            onClick={() => { void onReadMoreNews(n) }}
                            className="btn btn-sm btn-ghost"
                          >
                            Read more
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {!search && feedView === 'explore' && trending.length > 0 && (
            <>
              <div className="sec-hd"><h3>Trending</h3><span className="see-all">See all</span></div>
              <div style={{ display:'flex', gap:11, padding:'0 16px 4px', overflowX:'auto' }}>
                {trending.map(b => (
                  <div key={b.id} onClick={() => onView(b.id)} style={{ width:158, flexShrink:0, background:'#152236', borderRadius:16, overflow:'hidden', cursor:'pointer', border:'1px solid rgba(255,255,255,0.07)' }}>
                    <div className={grad(b.id)} style={{ height:74, display:'flex', alignItems:'flex-end', padding:'0 9px 8px' }}>
                      <div style={{ width:36, height:36, borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Syne, sans-serif', fontWeight:800, fontSize:13, color:'#fff', background:'rgba(0,0,0,0.3)', border:'2px solid rgba(255,255,255,0.2)', overflow:'hidden' }}>
                        {normalizeLogoImage(b.logo) || normalizeLogoImage(b.logo_url)
                          ? <img src={(normalizeLogoImage(b.logo) || normalizeLogoImage(b.logo_url)) || ''} alt={b.name} style={{ width:'100%', height:'100%', objectFit:'cover' as const }} />
                          : logoInitials(b.name)}
                      </div>
                    </div>
                    <div style={{ padding:'9px 10px 11px' }}>
                      <div style={{ fontFamily:'Syne, sans-serif', fontSize:12.5, fontWeight:700, lineHeight:1.2 }}>{b.name}</div>
                      <div style={{ fontSize:10, color:'#7A92B0', marginTop:3 }}>{b.industry} · {b.city}</div>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:7 }}>
                        {b.kyc_verified ? <div style={{ display:'flex', alignItems:'center', gap:3 }}><span className="kyc-dot" /><span style={{ fontSize:9.5, color:'#00D4A0' }}>KYC</span></div> : <span style={{ fontSize:9.5, color:'#3A5070' }}>Unverified</span>}
                        <div style={{ fontSize:10, fontWeight:700, color:'#F5A623', background:'rgba(245,166,35,0.12)', padding:'2px 6px', borderRadius:6 }}>⭐ {b.trust_score}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ height:14 }} />
            </>
          )}

          {(feedView === 'explore' || feedView === 'connected') && (
            <>
          <div className="sec-hd">
            <h3>{feedView === 'connected' ? 'Connected Businesses' : 'Explore businesses'}</h3>
            <span className="see-all">
              {search.trim()
                ? `${items.length} match${items.length === 1 ? '' : 'es'}`
                : `${items.length} found`}
            </span>
          </div>
          {search.trim() ? (
            <div style={{ margin:'-6px 16px 10px', fontSize:11.5, color:'#7A92B0', fontWeight:600 }}>
              Searching: <span style={{ color:'#E8EEF5' }}>{search.trim()}</span>
            </div>
          ) : null}

          {items.length === 0 && (
            <div className="empty">
              <div className="ico">{feedView === 'connected' ? '🤝' : '🔍'}</div>
              <h3>
                {feedView === 'connected'
                  ? 'No connected businesses yet'
                  : search.trim()
                    ? 'No matches for that search'
                    : 'No businesses found'}
              </h3>
              <p>
                {feedView === 'connected'
                  ? 'Connect with businesses from Explore.'
                  : search.trim()
                    ? 'Try different words, clear the search box, or change the industry chip above.'
                    : 'Try a different search or filter'}
              </p>
            </div>
          )}

          {items.map(b => {
            const isSaved = saved.has(b.id)
            const isConn = linkedBizIds.has(normalizeUuid(b.id))
            const bizName = cleanDisplayText(b.name) || 'Business'
            const bizIndustry = cleanDisplayText(b.industry) || 'Other'
            const bizCity = cleanDisplayText(b.city)
            const bizCountry = cleanDisplayText(b.country)
            const bizTagline = cleanDisplayText(b.tagline)
            return (
              <div key={b.id} style={{ margin:'0 16px 11px', background:'#152236', borderRadius:16, padding:13, border:'1px solid rgba(255,255,255,0.07)' }}>
                <div style={{ display:'flex', alignItems:'center', gap:9, marginBottom:9 }}>
                  <div className={grad(b.id)} onClick={() => onView(b.id)} style={{ width:40, height:40, borderRadius:12, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Syne, sans-serif', fontWeight:800, fontSize:15, color:'#fff', flexShrink:0, cursor:'pointer', overflow:'hidden' }}>
                    {normalizeLogoImage(b.logo) || normalizeLogoImage(b.logo_url)
                      ? <img src={(normalizeLogoImage(b.logo) || normalizeLogoImage(b.logo_url)) || ''} alt={bizName} style={{ width:'100%', height:'100%', objectFit:'cover' as const }} />
                      : logoInitials(bizName)}
                  </div>
                  <div style={{ flex:1, cursor:'pointer' }} onClick={() => onView(b.id)}>
                    <div style={{ fontFamily:'Syne, sans-serif', fontSize:13.5, fontWeight:700 }}>{bizName}</div>
                    <div style={{ fontSize:10.5, color:'#7A92B0', marginTop:2 }}>{bizIndustry} · {bizCity}{bizCountry ? `, ${bizCountry}` : ''}</div>
                  </div>
                  {b.kyc_verified && <span className="badge badge-kyc">✅ KYC</span>}
                </div>
                <div style={{ fontSize:12.5, color:'#7A92B0', marginBottom:9, lineHeight:1.5 }}>{bizTagline}</div>
                {(b.products?.length || 0) > 0 && (
                  <div style={{ display:'flex', gap:7, overflowX:'auto', marginBottom:9 }}>
                    {b.products!.slice(0,3).map(p => (
                      <div key={p.id} style={{ width:86, flexShrink:0, borderRadius:11, background:'#1A2D47', padding:'9px 7px 8px', display:'flex', flexDirection:'column', alignItems:'center', border:'1px solid rgba(255,255,255,0.07)' }}>
                        <div style={{ fontSize:22, marginBottom:4 }}>{p.emoji}</div>
                        <div style={{ fontSize:9.5, fontWeight:600, textAlign:'center', lineHeight:1.3 }}>{p.name}</div>
                        <div style={{ fontSize:9.5, color:'#4D9DFF', fontWeight:700, marginTop:2 }}>{p.price}</div>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display:'flex', gap:6, paddingTop:9, borderTop:'1px solid rgba(255,255,255,0.07)' }}>
                  <button onClick={() => doSave(b)} style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:4, fontSize:11, fontWeight:600, color:isSaved?'#FF6B35':'#7A92B0', background:'none', border:'none', flex:1, padding:5, borderRadius:7, cursor:'pointer' }}>
                    {isSaved ? '💾 Saved' : '🔖 Save'}
                  </button>
                  <button onClick={() => toast('RFQ sent to ' + b.name, 'info')} style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:4, fontSize:11, fontWeight:600, color:'#7A92B0', background:'none', border:'none', flex:1, padding:5, borderRadius:7, cursor:'pointer' }}>
                    📋 RFQ
                  </button>
                  {(feedView === 'explore' || feedView === 'connected') && (
                    <button onClick={() => doConnect(b)} className={`btn btn-sm ${isConn?'btn-ghost':'btn-blue'}`} style={{ flexShrink:0 }}>
                      {isConn ? 'Disconnect' : 'Connect'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
            </>
          )}
        </>
      )}
      {openNewsletterNews && (
        <div
          onClick={() => setOpenNewsletterNewsId(null)}
          style={{
            position:'fixed',
            inset:0,
            background:'rgba(3,8,16,0.7)',
            zIndex:1200,
            display:'flex',
            alignItems:'flex-end',
            justifyContent:'center',
            padding:'12px 10px',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width:'100%',
              maxWidth:560,
              maxHeight:'84vh',
              overflowY:'auto',
              background:'#0F1D31',
              border:'1px solid rgba(255,255,255,0.08)',
              borderRadius:16,
              padding:14,
              boxShadow:'0 14px 40px rgba(0,0,0,0.35)',
            }}
          >
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, marginBottom:8 }}>
              <div>
                <div style={{ fontSize:10.5, color:'#7A92B0', fontWeight:700 }}>Full News</div>
                <h3 style={{ margin:'4px 0 0', fontSize:16, lineHeight:1.35, fontFamily:'Syne, sans-serif' }}>{stripNewsSourceNoise(openNewsletterNews.title)}</h3>
              </div>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpenNewsletterNewsId(null)}>Close</button>
            </div>

            <div style={{ fontSize:11, color:'#7A92B0', marginBottom:10 }}>
              {fmtDate(openNewsletterNews.published_at)}
            </div>

            <div style={{ background:'#152236', border:'1px solid rgba(255,255,255,0.07)', borderRadius:12, padding:10, marginBottom:10 }}>
              {readMoreLoading ? (
                <div style={{ display:'flex', justifyContent:'center', padding:'16px 0' }}><div className="spinner" /></div>
              ) : (
                <p style={{ margin:0, fontSize:13.2, lineHeight:1.72, whiteSpace:'pre-line' }}>
                  {openNewsletterSummary}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
      <div style={{ height:8 }} />
    </div>
  )
}
