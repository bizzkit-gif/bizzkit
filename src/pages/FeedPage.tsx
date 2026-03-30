import React, { useState, useEffect } from 'react'
import { sb, Business, INDUSTRIES, grad } from '../lib/db'
import { useApp } from '../context/ctx'

export default function FeedPage({ onView }: { onView: (id: string) => void }) {
  const { myBiz, user, toast } = useApp()
  const [list, setList] = useState<Business[]>([])
  const [filter, setFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [conns, setConns] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    sb.from('businesses').select('*,products(*)').order('trust_score', { ascending: false })
      .then(({ data }) => { setList((data || []).filter(b => b.id !== myBiz?.id)); setLoading(false) })
    if (user) sb.from('saved_businesses').select('business_id').eq('user_id', user.id)
      .then(({ data }) => setSaved(new Set((data || []).map((s: any) => s.business_id))))
    if (myBiz) sb.from('connections').select('to_biz_id').eq('from_biz_id', myBiz.id)
      .then(({ data }) => setConns(new Set((data || []).map((c: any) => c.to_biz_id))))
  }, [myBiz?.id, user?.id])

  const items = list.filter(b => {
    const mf = filter === 'All' || b.industry === filter
    const ms = !search || b.name.toLowerCase().includes(search.toLowerCase())
    return mf && ms
  })

  const trending = items.filter(b => b.trust_score >= 70).slice(0, 4)

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
    await sb.from('connections').insert([
      { from_biz_id: myBiz.id, to_biz_id: b.id },
      { from_biz_id: b.id, to_biz_id: myBiz.id }
    ])
    await sb.rpc('get_or_create_chat', { biz_a: myBiz.id, biz_b: b.id })
    setConns(s => new Set([...s, b.id]))
    toast('Connected with ' + b.name + '!')
  }

  return (
    <div style={{ paddingBottom:16 }}>
      <div className="topbar">
        <div className="logo-txt">bizz<span>kit</span></div>
        <div style={{ display:'flex', gap:7 }}>
          <div className="icon-btn">🔔</div>
          {myBiz && <div className="avatar-btn">{myBiz.logo.slice(0,2)}</div>}
        </div>
      </div>

      <div className="search-wrap">
        <span style={{ fontSize:15, color:'#7A92B0' }}>🔍</span>
        <input placeholder="Search businesses…" value={search} onChange={e => setSearch(e.target.value)} />
        {search && <span style={{ cursor:'pointer', color:'#7A92B0', fontSize:18 }} onClick={() => setSearch('')}>×</span>}
      </div>

      {!search && (
        <div style={{ margin:'0 16px 15px', borderRadius:18, padding:'18px 18px 16px', background:'linear-gradient(135deg,#0C2340,#1A3D6E)', position:'relative', overflow:'hidden' }}>
          <div style={{ fontFamily:'Syne, sans-serif', fontSize:17, fontWeight:800, color:'#fff', marginBottom:12, lineHeight:1.3 }}>
            MENA Tech<br /><span style={{ color:'#FF6B35' }}>Showcase 2026</span>
          </div>
          <button className="btn btn-blue btn-sm" onClick={() => toast('Opening MENA Tech Showcase', 'info')}>Explore Now</button>
        </div>
      )}

      <div className="chips">
        {['All', ...INDUSTRIES.slice(0,6)].map(i => (
          <div key={i} className={`chip${filter===i?' on':''}`} onClick={() => setFilter(i)}>{i}</div>
        ))}
      </div>

      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', padding:'40px 0' }}><div className="spinner" /></div>
      ) : (
        <>
          {!search && trending.length > 0 && (
            <>
              <div className="sec-hd"><h3>Trending</h3><span className="see-all">See all</span></div>
              <div style={{ display:'flex', gap:11, padding:'0 16px 4px', overflowX:'auto' }}>
                {trending.map(b => (
                  <div key={b.id} onClick={() => onView(b.id)} style={{ width:158, flexShrink:0, background:'#152236', borderRadius:16, overflow:'hidden', cursor:'pointer', border:'1px solid rgba(255,255,255,0.07)' }}>
                    <div className={grad(b.id)} style={{ height:74, display:'flex', alignItems:'flex-end', padding:'0 9px 8px' }}>
                      <div style={{ width:36, height:36, borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Syne, sans-serif', fontWeight:800, fontSize:13, color:'#fff', background:'rgba(0,0,0,0.3)', border:'2px solid rgba(255,255,255,0.2)' }}>{b.logo}</div>
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

          <div className="sec-hd">
            <h3>{search ? `"${search}"` : 'All Businesses'}</h3>
            <span className="see-all">{items.length} found</span>
          </div>

          {items.length === 0 && <div className="empty"><div className="ico">🔍</div><h3>No businesses found</h3><p>Try a different search</p></div>}

          {items.map(b => {
            const isSaved = saved.has(b.id)
            const isConn = conns.has(b.id)
            return (
              <div key={b.id} style={{ margin:'0 16px 11px', background:'#152236', borderRadius:16, padding:13, border:'1px solid rgba(255,255,255,0.07)' }}>
                <div style={{ display:'flex', alignItems:'center', gap:9, marginBottom:9 }}>
                  <div className={grad(b.id)} onClick={() => onView(b.id)} style={{ width:40, height:40, borderRadius:12, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Syne, sans-serif', fontWeight:800, fontSize:15, color:'#fff', flexShrink:0, cursor:'pointer' }}>{b.logo}</div>
                  <div style={{ flex:1, cursor:'pointer' }} onClick={() => onView(b.id)}>
                    <div style={{ fontFamily:'Syne, sans-serif', fontSize:13.5, fontWeight:700 }}>{b.name}</div>
                    <div style={{ fontSize:10.5, color:'#7A92B0', marginTop:2 }}>{b.industry} · {b.city}, {b.country}</div>
                  </div>
                  {b.kyc_verified && <span className="badge badge-kyc">✅ KYC</span>}
                </div>
                <div style={{ fontSize:12.5, color:'#7A92B0', marginBottom:9, lineHeight:1.5 }}>{b.tagline}</div>
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
                  <button onClick={() => doConnect(b)} className={`btn btn-sm ${isConn?'btn-ghost':'btn-blue'}`} style={{ flexShrink:0 }}>
                    {isConn ? '✓ Connected' : 'Connect'}
                  </button>
                </div>
              </div>
            )
          })}
        </>
      )}
      <div style={{ height:8 }} />
    </div>
  )
}
