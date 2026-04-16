import React, { useState, useEffect, useMemo } from 'react'
import { sb, Business, INDUSTRIES, grad, fmtDate, fetchBusinessProfilesByIds, otherConnectionBusinessId, otherChatParticipantId, normalizeUuid, deleteConnectionBetween } from '../lib/db'
import { useApp } from '../context/ctx'

/** Narrow columns + product fields — faster than `*,products(*)`. */
const FEED_BUSINESS_SELECT =
  'id,name,tagline,industry,city,country,type,logo,logo_url,kyc_verified,trust_score,products(id,name,emoji,price,category)'

const FEED_CACHE_PREFIX = 'bizzkit.feed.v2.'
const FEED_CACHE_MS = 120_000

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

export default function FeedPage({ onView }: { onView: (id: string) => void }) {
  const { myBiz, user, toast, setTab, unread, pendingRandomCallFromBusinessId, pendingChatCallFromBusinessId } = useApp()
  const [list, setList] = useState<Business[]>([])
  const [feedView, setFeedView] = useState<'feed'|'explore'|'connected'>('feed')
  const [filter, setFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [conns, setConns] = useState<Set<string>>(new Set())
  const [connectionPosts, setConnectionPosts] = useState<Array<{
    id: string
    business_id: string
    content: string
    media_url: string | null
    media_type: string | null
    created_at: string
  }>>([])
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

      const [{ data: businesses }, { data: savedRows }, connsRes, chatsRes] = await Promise.all([
        sb.from('businesses').select(FEED_BUSINESS_SELECT).order('trust_score', { ascending: false }),
        user?.id ? sb.from('saved_businesses').select('business_id').eq('user_id', user.id) : Promise.resolve({ data: [] as any[] }),
        ownBizId ? sb.from('connections').select('from_biz_id,to_biz_id').or(`from_biz_id.eq.${ownBizId},to_biz_id.eq.${ownBizId}`) : Promise.resolve({ data: [] as any[] }),
        ownBizId ? sb.from('chats').select('participant_a,participant_b').or(`participant_a.eq.${ownBizId},participant_b.eq.${ownBizId}`) : Promise.resolve({ data: [] as any[] })
      ])

      if (!active) return
      const connIds = new Set<string>()
      ;((connsRes.data as any[]) || []).forEach((c: any) => {
        if (!ownBizId) return
        const otherId = otherConnectionBusinessId(
          { from_biz_id: c.from_biz_id, to_biz_id: c.to_biz_id },
          ownBizId,
        )
        if (otherId && normalizeUuid(otherId) !== normalizeUuid(ownBizId)) connIds.add(normalizeUuid(otherId))
      })
      ;((chatsRes.data as any[]) || []).forEach((c: any) => {
        if (!ownBizId) return
        const otherId = otherChatParticipantId(
          { participant_a: c.participant_a, participant_b: c.participant_b },
          ownBizId,
        )
        if (otherId && normalizeUuid(otherId) !== normalizeUuid(ownBizId)) connIds.add(normalizeUuid(otherId))
      })
      let nextList = (businesses || []).filter(
        (b) => normalizeUuid(b.id) !== normalizeUuid(ownBizId || ''),
      ) as Business[]
      const inFeed = new Set(nextList.map((b) => normalizeUuid(b.id)))
      const missingConn = [...connIds].filter((id) => id && !inFeed.has(id))
      if (missingConn.length) {
        const extra = await fetchBusinessProfilesByIds(FEED_BUSINESS_SELECT, missingConn)
        nextList = [...nextList, ...extra.filter((b) => normalizeUuid(b.id) !== normalizeUuid(ownBizId || ''))]
      }
      setList(nextList)
      setSaved(new Set((savedRows || []).map((s: any) => s.business_id)))
      setConns(connIds)
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
  const connectedBase = list.filter((b) => conns.has(normalizeUuid(b.id)))
  const source = feedView === 'connected' ? connectedBase : feedView === 'explore' ? discoverBase : []

  const items = source.filter((b) => {
    const mf = filter === 'All' || b.industry === filter
    const ms = matchesSearchText(businessSearchBlob(b), search)
    return mf && ms
  })

  const trending = discoverBase.filter((b) => {
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
    if (conns.has(normalizeUuid(b.id))) {
      const r = await deleteConnectionBetween(myBiz.id, b.id)
      if (!r.ok) { toast('Failed to disconnect: ' + r.error, 'error'); return }
      setConns((s) => {
        const next = new Set(s)
        next.delete(normalizeUuid(b.id))
        return next
      })
      toast('Disconnected from ' + b.name)
      return
    }
    const { error: connErr } = await sb.from('connections').insert({ from_biz_id: myBiz.id, to_biz_id: b.id })
    if (connErr) { toast('Failed to connect: ' + connErr.message, 'error'); return }
    const { error: chatErr } = await sb.rpc('get_or_create_chat', { biz_a: myBiz.id, biz_b: b.id })
    if (chatErr) { toast('Connected, but chat setup failed', 'info') }
    setConns((s) => new Set([...s, normalizeUuid(b.id)]))
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
          {feedView === 'feed' && myBiz && (
            <>
              <div className="sec-hd"><h3>Your posts & connections</h3><span className="see-all">{connectionFeedPosts.length} posts</span></div>
              {connectionFeedPosts.length === 0 ? (
                <div style={{ margin:'0 16px 14px', padding:'16px', background:'#152236', borderRadius:14, border:'1px solid rgba(255,255,255,0.07)', fontSize:12.5, color:'#7A92B0', textAlign:'center' }}>
                  No posts yet. Share from your profile (Posts tab), and posts from businesses you connect with will appear here too.
                </div>
              ) : (
                <div style={{ padding:'0 16px', marginBottom:14 }}>
                  {connectionFeedPosts.map(p => {
                    const b = bizById.get(normalizeUuid(p.business_id))
                    const isOwn = myBiz ? normalizeUuid(p.business_id) === normalizeUuid(myBiz.id) : false
                    const bizName = b ? cleanDisplayText(b.name) || 'Business' : 'Business'
                    const logoSrc = b ? (normalizeLogoImage(b.logo) || normalizeLogoImage(b.logo_url)) : null
                    return (
                      <div key={p.id} style={{ background:'#152236', borderRadius:14, padding:13, border:`1px solid ${isOwn ? 'rgba(30,126,247,0.35)' : 'rgba(255,255,255,0.07)'}`, marginBottom:10 }}>
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
                  })}
                </div>
              )}
            </>
          )}

          {feedView === 'feed' && !myBiz && (
            <div className="empty" style={{ marginTop:8 }}>
              <div className="ico">📝</div>
              <h3>Create your profile</h3>
              <p>Add a business profile to see your feed and posts from connections.</p>
            </div>
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
            const isConn = conns.has(normalizeUuid(b.id))
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
      <div style={{ height:8 }} />
    </div>
  )
}
