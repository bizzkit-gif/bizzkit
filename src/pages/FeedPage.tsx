import React, { useState, useEffect } from 'react'
import { sb, Business, INDUSTRIES, grad, fmtDate } from '../lib/db'
import { useApp } from '../context/ctx'

/** Narrow columns + product fields — faster than `*,products(*)`. */
const FEED_BUSINESS_SELECT =
  'id,name,tagline,industry,city,country,type,logo,logo_url,kyc_verified,trust_score,products(id,name,emoji,price,category)'

const FEED_CACHE_PREFIX = 'bizzkit.feed.v1.'
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
      const nextList = (businesses || []).filter(b => b.id !== ownBizId) as Business[]
      setList(nextList)
      setSaved(new Set((savedRows || []).map((s: any) => s.business_id)))
      const connIds = new Set<string>()
      ;((connsRes.data as any[]) || []).forEach((c: any) => {
        const otherId = c.from_biz_id === ownBizId ? c.to_biz_id : c.from_biz_id
        if (otherId && otherId !== ownBizId) connIds.add(otherId)
      })
      ;((chatsRes.data as any[]) || []).forEach((c: any) => {
        const otherId = c.participant_a === ownBizId ? c.participant_b : c.participant_a
        if (otherId && otherId !== ownBizId) connIds.add(otherId)
      })
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

  const discoverBase = list.filter(b => !conns.has(b.id))
  const connectedBase = list.filter(b => conns.has(b.id))
  const source = feedView === 'connected' ? connectedBase : feedView === 'explore' ? discoverBase : []

  const items = source.filter(b => {
    const mf = filter === 'All' || b.industry === filter
    const ms = !search || b.name.toLowerCase().includes(search.toLowerCase())
    return mf && ms
  })

  const trending = discoverBase.filter(b => {
    const mf = filter === 'All' || b.industry === filter
    const ms = !search || b.name.toLowerCase().includes(search.toLowerCase())
    return mf && ms && b.trust_score >= 70
  }).slice(0, 4)

  const bizById = new Map<string, Business>(list.map(b => [b.id, b] as const))
  if (myBiz) bizById.set(myBiz.id, myBiz)
  const connectionFeedPosts = connectionPosts.filter(p => {
    const b = bizById.get(p.business_id)
    if (!b) return true
    const industryOk = filter === 'All' || b.industry === filter
    const searchLower = search.toLowerCase()
    const textMatch = !search || (p.content || '').toLowerCase().includes(searchLower) || b.name.toLowerCase().includes(searchLower)
    return industryOk && textMatch
  })

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
    if (conns.has(b.id)) { toast('Already connected!', 'info'); return }
    const { error: connErr } = await sb.from('connections').insert({ from_biz_id: myBiz.id, to_biz_id: b.id })
    if (connErr) { toast('Failed to connect: ' + connErr.message, 'error'); return }
    const { error: chatErr } = await sb.rpc('get_or_create_chat', { biz_a: myBiz.id, biz_b: b.id })
    if (chatErr) { toast('Connected, but chat setup failed', 'info') }
    setConns(s => new Set([...s, b.id]))
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
          { id:'feed' as const, label:'Feed' },
          { id:'explore' as const, label:'Explore' },
          { id:'connected' as const, label:'Connected' }
        ]).map(v => (
          <button
            key={v.id}
            type="button"
            title={v.id === 'explore' ? 'Explore businesses' : v.id === 'connected' ? 'Connected businesses' : 'Your feed'}
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
                    const b = bizById.get(p.business_id)
                    const isOwn = p.business_id === myBiz.id
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
            <h3>{search ? `"${search}"` : feedView === 'connected' ? 'Connected Businesses' : 'Explore businesses'}</h3>
            <span className="see-all">{items.length} found</span>
          </div>

          {items.length === 0 && (
            <div className="empty">
              <div className="ico">{feedView === 'connected' ? '🤝' : '🔍'}</div>
              <h3>{feedView === 'connected' ? 'No connected businesses yet' : 'No businesses found'}</h3>
              <p>{feedView === 'connected' ? 'Connect with businesses from Explore.' : 'Try a different search or filter'}</p>
            </div>
          )}

          {items.map(b => {
            const isSaved = saved.has(b.id)
            const isConn = conns.has(b.id)
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
                  {feedView === 'explore' && (
                    <button onClick={() => doConnect(b)} className={`btn btn-sm ${isConn?'btn-ghost':'btn-blue'}`} style={{ flexShrink:0 }}>
                      {isConn ? '✓ Connected' : 'Connect'}
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
