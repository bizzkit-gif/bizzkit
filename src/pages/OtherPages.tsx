import React, { useState, useEffect, useCallback, useRef } from 'react'
import { sb, Business, Product, Conference, INDUSTRIES, COUNTRIES, TIMES, grad, getLogo, tier, tierIcon, tierColor, indEmoji, fmtDate, uploadImage, getLastUploadError, RANDOM_CALL_INVITE_MARKER, randomCallInviteMessageRinging, markLatestRandomCallInviteAsMissed, conferenceSessionInviteMessage, notifySessionExternal, fetchBusinessProfilesByIds, otherConnectionBusinessId, normalizeUuid, deleteConnectionBetween, DELETE_ACCOUNT_CONFIRM, deleteMyAccount } from '../lib/db'
import { clearEmailHasProfile } from '../lib/profileLocal'
import { PeerVideoCall } from '../components/PeerVideoCall'
import { sendPushNotification } from '../lib/push'
import { useApp } from '../context/ctx'
import { openReportProblem } from '../lib/reportProblem'
import { vibrateIfEnabled } from '../lib/notificationSettings'

const GRADS = ['gr1','gr2','gr3','gr4','gr5','gr6','gr7','gr8']
const normalizeLogoImage = (value?: string | null): string | null => {
  if (!value) return null
  let v = value.trim()
  if (!v) return null
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1).trim()
  if (!v) return null
  if (v.startsWith('data:')) return v
  if (v.startsWith('http://') || v.startsWith('https://') || v.startsWith('/')) return v
  // Handle legacy raw base64 strings stored without a data URL prefix.
  if (/^[A-Za-z0-9+/=]+$/.test(v) && v.length > 120) return `data:image/jpeg;base64,${v}`
  return null
}
const logoText = (name?: string) => getLogo(name || '')

const PROFILE_POST_SELECT = 'id,business_id,content,media_url,media_type,created_at'
const PROFILE_POSTS_CACHE_PREFIX = 'bizzkit.profile.posts.v1.'
const PROFILE_POSTS_CACHE_MS = 120_000
const CONNECTIONS_CARD_SELECT = 'id,name,industry,city,logo,logo_url'
const CONF_CACHE_KEY = 'bizzkit.conferences.v1'
const CONF_CACHE_MS = 90_000

// ── PROFILE PAGE ─────────────────────────────────────────────────
export function ProfilePage({ viewId, onBack, onChat, onTrust }: { viewId?:string|null; onBack?:()=>void; onChat?:(id:string)=>void; onTrust?:()=>void }) {
const { user, myBiz, refreshBiz, toast, signOut, setTab: setAppTab, setPrevTab } = useApp()
const isOwn = !viewId || viewId === myBiz?.id
const [biz, setBiz] = useState<Business|null>(null)
const [tab, setTab] = useState<'posts'|'about'>('posts')
type BizPost = {
  id: string
  business_id: string
  content: string
  media_url?: string | null
  media_type?: 'image' | 'video' | null
  likes?: number
  created_at: string
}

const [editing, setEditing] = useState(false)
const [isConn, setIsConn] = useState(false)
const [loading, setLoading] = useState(true)
const [bizPosts, setBizPosts] = useState<BizPost[]>([])
const [postContent, setPostContent] = useState('')
const [postMedia, setPostMedia] = useState('')
const [postMediaType, setPostMediaType] = useState<'image'|'video'|''>('')
const [posting, setPosting] = useState(false)
const [postUploading, setPostUploading] = useState(false)
const [connections, setConnections] = useState<Business[]>([])
const [postErr, setPostErr] = useState('')
const [likedPostIds, setLikedPostIds] = useState<Set<string>>(new Set())
const [likingPostIds, setLikingPostIds] = useState<Set<string>>(new Set())
const [deleteAccountBusy, setDeleteAccountBusy] = useState(false)

const runDeleteAccount = async () => {
  if (
    !window.confirm(
      'Permanently delete your Bizzkit account? Your login, business profile, posts, chats, and related data will be removed. This cannot be undone.',
    )
  ) {
    return
  }
  const typed = window.prompt(`To confirm, type exactly:\n${DELETE_ACCOUNT_CONFIRM}`)
  const normalizedTyped = (typed || '').trim().toUpperCase()
  const normalizedConfirm = DELETE_ACCOUNT_CONFIRM.trim().toUpperCase()
  if (!normalizedTyped || normalizedTyped !== normalizedConfirm) {
    if (typed !== null) toast('Text did not match — account was not deleted.', 'error')
    return
  }
  setDeleteAccountBusy(true)
  const res = await deleteMyAccount(DELETE_ACCOUNT_CONFIRM)
  setDeleteAccountBusy(false)
  if (!res.ok) {
    toast(res.error, 'error')
    return
  }
  const em = user?.email ? String(user.email).toLowerCase().trim() : ''
  if (em) clearEmailHasProfile(em)
  toast('Account deleted.', 'success')
  await signOut()
}

useEffect(() => {
  if (!biz?.id || tab !== 'posts') return
  const cacheKey = `${PROFILE_POSTS_CACHE_PREFIX}${biz.id}`
  const loadPostsAndLikes = async () => {
    try {
      const raw = sessionStorage.getItem(cacheKey)
      if (raw) {
        const parsed = JSON.parse(raw) as { t: number; rows: BizPost[] }
        if (Date.now() - parsed.t < PROFILE_POSTS_CACHE_MS && parsed.rows?.length) {
          setBizPosts(parsed.rows)
        }
      }
    } catch {
      /* ignore */
    }

    const { data: posts } = await sb
      .from('posts')
      .select(PROFILE_POST_SELECT)
      .eq('business_id', biz.id)
      .order('created_at', { ascending: false })
    const nextPosts = (posts || []) as BizPost[]
    setBizPosts(nextPosts)
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), rows: nextPosts }))
    } catch {
      /* quota */
    }
    if (!myBiz || !nextPosts.length) {
      setLikedPostIds(new Set())
      return
    }
    const postIds = nextPosts.map((p) => p.id)
    const { data: likedRows } = await sb.from('post_likes').select('post_id').eq('business_id', myBiz.id).in('post_id', postIds)
    setLikedPostIds(new Set((likedRows || []).map((row: { post_id: string }) => row.post_id)))
  }
  void loadPostsAndLikes()
}, [biz?.id, tab, myBiz?.id])

useEffect(() => {
if (isOwn) { setBiz(myBiz); setLoading(false); return }
sb.from('businesses').select('*,products(id,name,emoji,price,category)').eq('id', viewId!).single().then(({ data }) => { setBiz(data); setLoading(false) })
if (myBiz && viewId) {
  void sb
    .from('connections')
    .select('from_biz_id,to_biz_id')
    .or(`from_biz_id.eq.${myBiz.id},to_biz_id.eq.${myBiz.id}`)
    .then(({ data: rows }) => {
      const a = normalizeUuid(myBiz.id)
      const b = normalizeUuid(viewId)
      const hit = (rows || []).some(
        (r: { from_biz_id: string; to_biz_id: string }) =>
          (normalizeUuid(r.from_biz_id) === a && normalizeUuid(r.to_biz_id) === b) ||
          (normalizeUuid(r.from_biz_id) === b && normalizeUuid(r.to_biz_id) === a),
      )
      setIsConn(hit)
    })
}
}, [isOwn, viewId, myBiz])

useEffect(() => {
  if (!biz?.id) { setConnections([]); return }
  const loadConnections = async () => {
    const { data: connRows, error } = await sb
      .from('connections')
      .select('from_biz_id,to_biz_id')
      .or(`from_biz_id.eq.${biz.id},to_biz_id.eq.${biz.id}`)
    if (error || !connRows?.length) { setConnections([]); return }
    const ids = Array.from(
      new Set(
        connRows
          .map((c) => otherConnectionBusinessId(c, biz.id))
          .filter((id): id is string => !!id && normalizeUuid(id) !== normalizeUuid(biz.id)),
      ),
    )
    if (!ids.length) { setConnections([]); return }
    const connBiz = await fetchBusinessProfilesByIds(CONNECTIONS_CARD_SELECT, ids)
    setConnections(connBiz)
  }
  loadConnections()
}, [biz?.id])

const doConnect = async () => {
if (!myBiz || !biz) { toast('Create a profile first', 'info'); return }
if (isConn) {
  const r = await deleteConnectionBetween(myBiz.id, biz.id)
  if (!r.ok) { toast('Failed to disconnect: ' + r.error, 'error'); return }
  setIsConn(false)
  setConnections((prev) => prev.filter((c) => normalizeUuid(c.id) !== normalizeUuid(myBiz.id)))
  toast('Disconnected from ' + biz.name)
  return
}
const { error: connErr } = await sb.from('connections').insert({ from_biz_id:myBiz.id, to_biz_id:biz.id })
if (connErr) { toast('Failed to connect: ' + connErr.message, 'error'); return }
await sb.rpc('get_or_create_chat', { biz_a:myBiz.id, biz_b:biz.id })
setIsConn(true)
if (isOwn) {
  const { data: connBiz } = await sb.from('businesses').select('*').eq('id', biz.id).single()
  if (connBiz) setConnections(prev => prev.some(c => c.id === connBiz.id) ? prev : [...prev, connBiz])
}
toast('Connected with ' + biz.name + '!')
}

if (loading) return <div style={{ display:'flex', justifyContent:'center', padding:'60px 0' }}><div className="spinner" /></div>
if (editing && isOwn) return <BizForm existing={biz||undefined} onSaved={async () => {
  setEditing(false)
  const refreshed = await refreshBiz()
  if (refreshed) setBiz(refreshed)
  toast(biz?'Profile updated!':'Profile created!')
}} onCancel={() => setEditing(false)} />
if (isOwn && !myBiz) return <BizForm onSaved={async () => {
  const refreshed = await refreshBiz()
  if (refreshed) {
    setBiz(refreshed)
    toast('Profile created!')
  } else {
    toast('Profile saved. Loading your profile…', 'info', 3200)
  }
}} />
if (!biz) return <div style={{ padding:'80px 20px', textAlign:'center', color:'#7A92B0' }}>Business not found</div>
const logoRenderUrl = (() => {
  const imageValue = normalizeLogoImage(biz.logo) || normalizeLogoImage(biz.logo_url)
  if (!imageValue) return null
  if (imageValue.startsWith('data:')) return imageValue
  // Do not append cache-busting params to signed URLs; it can invalidate the signature.
  const isSignedUrl = imageValue.includes('/object/sign/') || imageValue.includes('token=')
  if (isSignedUrl) return imageValue
  return `${imageValue}${imageValue.includes('?') ? '&' : '?'}v=${encodeURIComponent(biz.updated_at||'')}`
})()

  const handlePostMedia = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 50 * 1024 * 1024) { toast('File must be under 50MB', 'error'); e.target.value = ''; return }
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) { toast('Only image or video files are allowed', 'error'); e.target.value = ''; return }
    setPostErr('')
    setPostUploading(true)
    const folder = file.type.startsWith('video/') ? 'videos' : 'posts'
    const url = await uploadImage(file, folder)
    if (url) { setPostMedia(url); setPostMediaType(file.type.startsWith('video/') ? 'video' : 'image') }
    else {
      const msg = getLastUploadError() || 'Media upload failed'
      setPostErr(msg)
      toast(msg, 'error')
    }
    setPostUploading(false)
    e.target.value = ''
  }

  const submitPost = async () => {
    if (!postContent.trim()) { toast('Write something first', 'error'); return }
    if (!myBiz) { toast('Create a business profile first', 'info'); return }
    setPosting(true)
    setPostErr('')
    const { error } = await sb.from('posts').insert({ business_id:myBiz.id, content:postContent.trim(), media_url:postMedia||null, media_type:postMediaType||null })
    if (error) { toast('Failed to post: ' + error.message, 'error'); setPosting(false); return }
    setPostContent(''); setPostMedia(''); setPostMediaType('')
    sb.from('posts').select(PROFILE_POST_SELECT).eq('business_id', myBiz.id).order('created_at', { ascending:false }).then(({ data }) => {
      const rows = (data || []) as BizPost[]
      setBizPosts(rows)
      try {
        sessionStorage.setItem(`${PROFILE_POSTS_CACHE_PREFIX}${myBiz.id}`, JSON.stringify({ t: Date.now(), rows }))
      } catch { /* ignore */ }
    })
    setPosting(false)
    toast('Posted!')
  }

  const deletePost = async (postId: string) => {
    await sb.from('posts').delete().eq('id', postId)
    setBizPosts((p: BizPost[]) => {
      const next = p.filter((pp) => pp.id !== postId)
      if (biz?.id) {
        try {
          sessionStorage.setItem(`${PROFILE_POSTS_CACHE_PREFIX}${biz.id}`, JSON.stringify({ t: Date.now(), rows: next }))
        } catch { /* ignore */ }
      }
      return next
    })
  }

return (
<div style={{ paddingBottom:16 }}>
      <div
        style={{
          padding: '16px 16px 0',
          display: 'flex',
          flexDirection: 'row',
          justifyContent: isOwn ? 'space-between' : 'flex-start',
          alignItems: 'flex-start',
          gap: 12,
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0, flex: '1 1 auto' }}>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                background: '#152236',
                border: 'none',
                color: '#fff',
                fontSize: 18,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                alignSelf: 'flex-start',
              }}
            >
              ←
            </button>
          )}
          {logoRenderUrl ? (
            <img
              src={logoRenderUrl}
              alt={biz.name}
              style={{
                width: 104,
                height: 104,
                borderRadius: 26,
                objectFit: 'cover' as const,
                border: '3px solid #0A1628',
                boxShadow: '0 8px 28px rgba(30,126,247,0.4)',
                flexShrink: 0,
                display: 'block',
              }}
            />
          ) : (
            <div
              style={{
                width: 104,
                height: 104,
                borderRadius: 26,
                background: 'linear-gradient(135deg,#1E7EF7,#6C63FF)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'Syne, sans-serif',
                fontWeight: 800,
                fontSize: 34,
                color: '#fff',
                border: '3px solid #0A1628',
                boxShadow: '0 8px 28px rgba(30,126,247,0.4)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                alignSelf: 'flex-start',
              }}
            >
              {logoText(biz.name)}
            </div>
          )}
        </div>
        {isOwn && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 6,
              flexShrink: 0,
              alignSelf: 'flex-start',
              maxWidth: '46%',
              paddingTop: 0,
            }}
          >
            <button
              type="button"
              onClick={() => setEditing(true)}
              style={{
                padding: '8px 16px',
                borderRadius: 10,
                background: '#152236',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#fff',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                margin: 0,
                flexShrink: 0,
              }}
            >
              ✏️ Edit
            </button>
    <span style={{ fontSize: 11, color: '#1E7EF7', fontWeight: 700, cursor: 'pointer' }} onClick={onTrust}>
      Trust Score →
    </span>
          </div>
        )}
      </div>
      <div style={{ padding:'0 16px' }}>
<div style={{ marginTop:14 }}>
<div style={{ fontFamily:'Syne, sans-serif', fontSize:19, fontWeight:800 }}>{biz.name}</div>
<div style={{ fontSize:12.5, color:'#7A92B0', marginTop:3 }}>{biz.industry} · {biz.city}, {biz.country}</div>
</div>
<div style={{ display:'flex', gap:5, marginTop:9, flexWrap:'wrap' }}>
{biz.kyc_verified && <span className="badge badge-kyc">✅ KYC</span>}
<span style={{ display:'inline-flex', alignItems:'center', gap:3, padding:'3px 8px', borderRadius:7, fontSize:10, fontWeight:700, background:'rgba(245,166,35,0.15)', color:tierColor(biz.trust_tier) }}>{tierIcon(biz.trust_tier)} {biz.trust_tier} · {biz.trust_score}</span>
{biz.certified && <span className="badge badge-cert">🏅 Certified</span>}
<span className="badge badge-type">{biz.type}</span>
</div>
<div style={{ display:'grid', gridTemplateColumns:'1fr', gap:7, margin:'12px 0' }}>
{[{v:0,l:'Connections'}].map(s => (
<div key={s.l} style={{ background:'#152236', borderRadius:11, padding:'9px 7px', textAlign:'center', border:'1px solid rgba(255,255,255,0.07)' }}>
<div style={{ fontFamily:'Syne, sans-serif', fontSize:17, fontWeight:800, color:'#1E7EF7' }}>{connections.length}</div>
<div style={{ fontSize:9.5, color:'#7A92B0', marginTop:1 }}>{s.l}</div>
</div>
))}
</div>
{connections.length > 0 && (
<div style={{ margin:'0 0 12px' }}>
<div style={{ fontSize:11.5, color:'#7A92B0', marginBottom:7, fontWeight:700 }}>Connected Businesses</div>
<div style={{ display:'flex', gap:7, overflowX:'auto' }}>
{connections.map(c => (
<div key={c.id} style={{ background:'#152236', borderRadius:11, border:'1px solid rgba(255,255,255,0.07)', padding:'7px 9px', minWidth:132 }}>
<div style={{ fontSize:12, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.name}</div>
<div style={{ fontSize:10, color:'#7A92B0', marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.industry}</div>
</div>
))}
</div>
</div>
)}
{!isOwn && (
<div style={{ display:'flex', gap:7, marginBottom:15 }}>
<button onClick={doConnect} className={`btn btn-full ${isConn?'btn-ghost':'btn-blue'}`} style={{ flex:1 }}>{isConn?'Disconnect':'🤝 Connect'}</button>
<button onClick={() => onChat?.(biz.id)} className="btn btn-accent" style={{ flex:1 }}>💬 Message</button>
</div>
)}
</div>
<div style={{ display:'flex', borderBottom:'1px solid rgba(255,255,255,0.07)', margin:'0 0 14px' }}>
{(['posts','about'] as const).map(t => (
<div key={t} onClick={() => setTab(t)} style={{ flex:1, textAlign:'center', padding:'9px 4px', fontSize:12, fontWeight:600, cursor:'pointer', color:tab===t?'#1E7EF7':'#7A92B0', borderBottom:`2px solid ${tab===t?'#1E7EF7':'transparent'}` }}>
{t === 'posts' ? 'Posts' : 'About'}
</div>
))}
</div>
      {tab === 'posts' && (
        <div style={{ padding:'0 16px' }}>
          {isOwn && (
            <div style={{ background:'#152236', borderRadius:14, padding:13, border:'1px solid rgba(255,255,255,0.07)', marginBottom:14 }}>
              <textarea placeholder="Describe your product or service and add an image/video..." value={postContent} onChange={e => setPostContent(e.target.value)} style={{ width:'100%', background:'none', border:'none', outline:'none', color:'#fff', fontSize:13, resize:'none', minHeight:70, fontFamily:'DM Sans, sans-serif' }} />
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:8, borderTop:'1px solid rgba(255,255,255,0.07)', paddingTop:8 }}>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  {postMedia && (postMediaType === 'video' ? <video src={postMedia} style={{ width:40, height:40, borderRadius:8, objectFit:'cover' as const }} /> : <img src={postMedia} alt="preview" style={{ width:40, height:40, borderRadius:8, objectFit:'cover' as const }} />)}
                  <label style={{ padding:'6px 12px', borderRadius:9, background:'#0A1628', border:'1px solid rgba(255,255,255,0.07)', fontSize:11.5, color:'#7A92B0', cursor:'pointer', fontWeight:600 }}>
                    {postUploading ? 'Uploading...' : 'Photo/Video'}
                    <input type="file" accept="image/*,video/*" onChange={handlePostMedia} style={{ display:'none' }} />
                  </label>
                  {postMedia && <button onClick={() => { setPostMedia(''); setPostMediaType('') }} style={{ background:'none', border:'none', color:'#FF4B6E', fontSize:16, cursor:'pointer' }}>x</button>}
                </div>
                <button onClick={submitPost} disabled={posting||!postContent.trim()} className="btn btn-blue btn-sm">{posting?'Posting...':'Post'}</button>
              </div>
              {postErr && <div className="form-err" style={{ marginTop:8 }}>{postErr}</div>}
            </div>
          )}
          {bizPosts.length === 0 && <div className="empty"><div className="ico">📝</div><h3>No posts yet</h3><p>{isOwn ? 'Share your first image/video post!' : 'No posts yet'}</p></div>}
          {bizPosts.map((p) => (
            <div key={p.id} style={{ background:'#152236', borderRadius:14, padding:13, border:'1px solid rgba(255,255,255,0.07)', marginBottom:10 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  {logoRenderUrl ? <img src={logoRenderUrl} alt={biz?.name} style={{ width:32, height:32, borderRadius:9, objectFit:'cover' as const }} /> : <div style={{ width:32, height:32, borderRadius:9, background:'linear-gradient(135deg,#1E7EF7,#6C63FF)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:800, color:'#fff', overflow:'hidden' }}>{logoText(biz?.name)}</div>}
                  <div><div style={{ fontSize:12, fontWeight:700 }}>{biz?.name}</div><div style={{ fontSize:10, color:'#7A92B0' }}>{new Date(p.created_at).toLocaleDateString('en-GB', { day:'numeric', month:'short' })}</div></div>
                </div>
                {isOwn && <button onClick={() => deletePost(p.id)} style={{ background:'none', border:'none', color:'#FF4B6E', fontSize:13, cursor:'pointer', fontWeight:700 }}>Delete</button>}
              </div>
              <p style={{ fontSize:13, color:'#fff', lineHeight:1.6, marginBottom:p.media_url?10:0 }}>{p.content}</p>
              {p.media_url && (p.media_type === 'video' ? <video src={p.media_url} controls style={{ width:'100%', borderRadius:10, maxHeight:220 }} /> : <img src={p.media_url} alt="post" style={{ width:'100%', borderRadius:10, maxHeight:220, objectFit:'cover' as const }} />)}
              <div style={{ display:'flex', gap:8, marginTop:10, paddingTop:8, borderTop:'1px solid rgba(255,255,255,0.07)' }}>
                <button
                  onClick={async () => {
                    if (!myBiz) { toast('Create a business profile first', 'info'); return }
                    if (likedPostIds.has(p.id)) { toast('You already liked this post', 'info'); return }
                    if (likingPostIds.has(p.id)) return
                    setLikingPostIds((prev) => new Set([...prev, p.id]))
                    const { error } = await sb.from('post_likes').insert({ post_id:p.id, business_id:myBiz.id })
                    setLikingPostIds((prev) => {
                      const next = new Set(prev)
                      next.delete(p.id)
                      return next
                    })
                    if (error) {
                      if (error.message.toLowerCase().includes('duplicate')) {
                        setLikedPostIds((prev) => new Set([...prev, p.id]))
                        toast('You already liked this post', 'info')
                        return
                      }
                      toast('Failed to like post: ' + error.message, 'error')
                      return
                    }
                    setLikedPostIds((prev) => new Set([...prev, p.id]))
                    setBizPosts((prev) => prev.map((pp) => pp.id===p.id ? { ...pp, likes:(pp.likes||0)+1 } : pp))
                  }}
                  disabled={likedPostIds.has(p.id) || likingPostIds.has(p.id)}
                  style={{ flex:1, padding:'6px 0', background:likedPostIds.has(p.id)?'rgba(30,126,247,0.2)':'#0A1628', border:'1px solid rgba(255,255,255,0.07)', borderRadius:9, color:likedPostIds.has(p.id)?'#1E7EF7':'#7A92B0', fontSize:12, fontWeight:600, cursor:likedPostIds.has(p.id)?'default':'pointer' }}
                >
                  {likedPostIds.has(p.id) ? 'Liked' : likingPostIds.has(p.id) ? 'Liking...' : 'Like'} {p.likes||0}
                </button>
                {!isOwn && (
                  <button onClick={async () => {
                    if (!myBiz || !biz) return
                    if (myBiz.id === biz.id) { toast('You can only send RFQ to other businesses', 'info'); return }
                    const { data:chat } = await sb.rpc('get_or_create_chat', { biz_a:myBiz.id, biz_b:biz.id })
                    await sb.from('messages').insert({ chat_id:chat, sender_id:myBiz.id, text:'RFQ: I am interested in your products/services. Can we connect?' })
                    toast('RFQ sent!')
                  }} style={{ flex:1, padding:'6px 0', background:'rgba(30,126,247,0.15)', border:'1px solid rgba(30,126,247,0.3)', borderRadius:9, color:'#1E7EF7', fontSize:12, fontWeight:600, cursor:'pointer' }}>RFQ</button>
                )}
              </div>
            </div>
          ))}
          {isOwn && (
            <div
              style={{
                marginTop: 20,
                paddingTop: 16,
                borderTop: '1px solid rgba(255,255,255,0.07)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                alignItems: 'stretch',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setPrevTab('profile')
                  setAppTab('notifications')
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '4px 0',
                  fontSize: 12,
                  color: '#7A92B0',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left',
                  textDecoration: 'underline',
                }}
              >
                Notification settings
              </button>
              <button
                type="button"
                onClick={() => {
                  setPrevTab('profile')
                  setAppTab('legal')
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '4px 0',
                  fontSize: 12,
                  color: '#7A92B0',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left',
                  textDecoration: 'underline',
                }}
              >
                Privacy & Terms
              </button>
              <button
                type="button"
                onClick={() => openReportProblem(user?.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '4px 0',
                  fontSize: 12,
                  color: '#7A92B0',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left',
                  textDecoration: 'underline',
                }}
              >
                Report a problem
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-full btn-sm"
                style={{ marginTop: 4, border: '1px solid rgba(255,75,110,0.28)', color: '#FF8A9E' }}
                onClick={() => void signOut()}
              >
                Log out
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-full btn-sm"
                disabled={deleteAccountBusy}
                style={{
                  marginTop: 6,
                  border: '1px solid rgba(255,75,110,0.45)',
                  color: '#FF6B6B',
                  opacity: deleteAccountBusy ? 0.6 : 1,
                }}
                onClick={() => void runDeleteAccount()}
              >
                {deleteAccountBusy ? 'Deleting…' : 'Delete account'}
              </button>
            </div>
          )}
        </div>
      )}
{tab === 'about' && (
<div style={{ padding:'0 16px' }}>
<div style={{ background:'#152236', borderRadius:13, padding:13, border:'1px solid rgba(255,255,255,0.07)' }}>
<p style={{ fontSize:12.5, color:'#7A92B0', lineHeight:1.7 }}>{biz.description||'No description yet.'}</p>
<div style={{ marginTop:12 }}>
{[['Industry',biz.industry],['Type',biz.type],['City',biz.city],['Country',biz.country],...(biz.founded?[['Founded',biz.founded]]:[]),...(biz.website?[['Website',biz.website]]:[])].map(([l,v]) => (
<div key={l} style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid rgba(255,255,255,0.07)', fontSize:12 }}>
<span style={{ color:'#7A92B0' }}>{l}</span>
<span style={{ fontWeight:600 }}>{v}</span>
</div>
))}
</div>
</div>
</div>
)}
<div style={{ height:8 }} />
</div>
)
}

// ── BIZ FORM ──────────────────────────────────────────────────────
function BizForm({ existing, onSaved, onCancel }: { existing?:Business; onSaved:(created?:Business)=>void; onCancel?:()=>void }) {
const { user, toast } = useApp()
const [name, setName] = useState(existing?.name||'')
const [tagline, setTagline] = useState(existing?.tagline||'')
const [desc, setDesc] = useState(existing?.description||'')
const [ind, setInd] = useState(existing?.industry||'')
const [type, setType] = useState(existing?.type||'B2B')
const [city, setCity] = useState(existing?.city||'')
const [country, setCountry] = useState(existing?.country||'')
const [website, setWebsite] = useState(existing?.website||'')
const [founded, setFounded] = useState(existing?.founded||'')
const [err, setErr] = useState('')
const [saving, setSaving] = useState(false)
const [uploading, setUploading] = useState(false)
const [logoUrl, setLogoUrl] = useState(normalizeLogoImage(existing?.logo) || '')
const logoInputRef = useRef<HTMLInputElement | null>(null)
const lgo = getLogo(name)

const compressImageToDataUrl = (file: File, maxSide = 640, quality = 0.8): Promise<string> => new Promise((resolve, reject) => {
  const objectUrl = URL.createObjectURL(file)
  const img = new Image()
  img.onload = () => {
    try {
      const ratio = Math.min(1, maxSide / Math.max(img.width, img.height))
      const width = Math.max(1, Math.round(img.width * ratio))
      const height = Math.max(1, Math.round(img.height * ratio))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(objectUrl)
        reject(new Error('Canvas unavailable'))
        return
      }
      ctx.drawImage(img, 0, 0, width, height)
      const outType = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
      const dataUrl = canvas.toDataURL(outType, outType === 'image/jpeg' ? quality : undefined)
      URL.revokeObjectURL(objectUrl)
      resolve(dataUrl)
    } catch (err) {
      URL.revokeObjectURL(objectUrl)
      reject(err instanceof Error ? err : new Error('Compression failed'))
    }
  }
  img.onerror = () => {
    URL.revokeObjectURL(objectUrl)
    reject(new Error('Failed to load image'))
  }
  img.src = objectUrl
})

const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
const file = e.target.files?.[0]
if (!file) return
if (file.size > 10 * 1024 * 1024) { setErr('File must be under 10MB'); return }
if (!file.type.startsWith('image/')) { setErr('Logo must be an image file'); return }
setErr('')
setUploading(true)
try {
  // Compress before saving so profile updates stay lightweight and fast.
  const dataUrl = await compressImageToDataUrl(file)
  setLogoUrl(dataUrl)
  // Persist logo immediately for existing profiles so the icon updates right away.
  if (existing?.id) {
    const { error: logoSaveErr } = await sb.from('businesses').update({ logo:dataUrl }).eq('id', existing.id)
    if (logoSaveErr) {
      const msg = 'Logo uploaded but failed to save profile: ' + logoSaveErr.message
      setErr(msg)
      toast(msg, 'error')
      setUploading(false)
      e.target.value = ''
      return
    }
  }
  toast('Photo updated!')
} catch {
  const msg = 'Upload failed - please try again'
  setErr(msg)
  toast(msg, 'error')
}
setUploading(false)
e.target.value = ''
}

const validate = () => {
if (!name.trim()) { setErr('Business name required'); return false }
if (!ind) { setErr('Select an industry'); return false }
if (!city.trim()) { setErr('City required'); return false }
if (!country) { setErr('Country required'); return false }
if (!desc.trim()) { setErr('Description required'); return false }
setErr(''); return true
}

const save = async () => {
if (!validate() || !user) return
setSaving(true)
const isSessionNotifySchemaError = (message: string): boolean => {
  const m = message.toLowerCase()
  return (
    m.includes('notify_session_invite_email') ||
    m.includes('notify_session_invite_whatsapp') ||
    m.includes('notify_session_calendar_reminders') ||
    m.includes('phone_whatsapp')
  )
}
const data = {
  owner_id:user.id, name:name.trim(), tagline:tagline.trim(), description:desc.trim(), industry:ind, type, city:city.trim(), country, website:website.trim(), founded:founded.trim(), logo:logoUrl||lgo, grad:GRADS[0], trust_score:existing?.trust_score||45, trust_tier:existing?.trust_tier||'Bronze', kyc_verified:existing?.kyc_verified||false, certified:existing?.certified||false,
  followers: existing?.followers || 0,
  phone_whatsapp: null,
  notify_session_invite_email: existing ? existing.notify_session_invite_email !== false : true,
  notify_session_invite_whatsapp: false,
  notify_session_calendar_reminders: existing ? existing.notify_session_calendar_reminders !== false : true,
}
if (existing) {
let { error } = await sb.from('businesses').update(data).eq('id', existing.id)
if (error && isSessionNotifySchemaError(error.message)) {
  const fallback = { ...data } as Omit<typeof data, 'phone_whatsapp' | 'notify_session_invite_email' | 'notify_session_invite_whatsapp' | 'notify_session_calendar_reminders'>
  delete (fallback as { phone_whatsapp?: null }).phone_whatsapp
  delete (fallback as { notify_session_invite_email?: boolean }).notify_session_invite_email
  delete (fallback as { notify_session_invite_whatsapp?: boolean }).notify_session_invite_whatsapp
  delete (fallback as { notify_session_calendar_reminders?: boolean }).notify_session_calendar_reminders
  const retry = await sb.from('businesses').update(fallback).eq('id', existing.id)
  error = retry.error
}
if (error) { setSaving(false); setErr(error.message); toast('Failed to save profile', 'error'); return }
} else {
let created: Business | undefined
let { data: insertedRow, error } = await sb.from('businesses').insert(data).select('*').single()
if (error && isSessionNotifySchemaError(error.message)) {
  const fallback = { ...data } as Omit<typeof data, 'phone_whatsapp' | 'notify_session_invite_email' | 'notify_session_invite_whatsapp' | 'notify_session_calendar_reminders'>
  delete (fallback as { phone_whatsapp?: null }).phone_whatsapp
  delete (fallback as { notify_session_invite_email?: boolean }).notify_session_invite_email
  delete (fallback as { notify_session_invite_whatsapp?: boolean }).notify_session_invite_whatsapp
  delete (fallback as { notify_session_calendar_reminders?: boolean }).notify_session_calendar_reminders
  const retry = await sb.from('businesses').insert(fallback).select('*').single()
  insertedRow = retry.data as Business | null
  error = retry.error
}
if (error) { setSaving(false); setErr(error.message); toast('Failed to create profile', 'error'); return }
created = (insertedRow as Business | null) || undefined
setSaving(false); onSaved(created); return
}
setSaving(false); onSaved()
}

return (
<div style={{ paddingBottom:20 }}>
<div className="topbar">
<div className="page-title">{existing?'Edit Profile':'Create Profile'}</div>
{onCancel && <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>}
</div>
<div style={{ padding:'0 16px' }}>
<div style={{ textAlign:'center', marginBottom:18 }}>
<div style={{ position:'relative', display:'inline-block' }}>
{logoUrl ? (
<img src={logoUrl} alt="Logo" style={{ width:80, height:80, borderRadius:20, objectFit:'cover' as const, border:'3px solid #1E7EF7' }} />
) : (
<div style={{ width:80, height:80, borderRadius:20, background:'linear-gradient(135deg,#1E7EF7,#6C63FF)', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Syne, sans-serif', fontWeight:800, fontSize:26, color:'#fff' }}>{lgo||'BK'}</div>
)}
<label htmlFor="logo-upload" style={{ position:'absolute', bottom:-6, right:-6, width:30, height:30, borderRadius:'50%', background:'#1E7EF7', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, cursor:'pointer', border:'2px solid #0A1628' }}>
{uploading ? '⏳' : '📷'}
</label>
<input ref={logoInputRef} id="logo-upload" type="file" accept="image/*" onChange={handleLogoUpload} style={{ position:'absolute', left:'-9999px', width:1, height:1, opacity:0 }} />
</div>
<div style={{ marginTop:10, display:'flex', justifyContent:'center' }}>
<button type="button" className="btn btn-ghost btn-sm" style={{ cursor:'pointer' }} onClick={() => logoInputRef.current?.click()}>{uploading ? 'Uploading...' : 'Upload Logo / Photo'}</button>
</div>
<div style={{ fontSize:10, color:'#7A92B0', marginTop:8 }}>PNG, JPG, WEBP or MP4</div>
</div>
<div className="field"><label>Business Name *</label><input placeholder="e.g. NexaTech Solutions" value={name} onChange={e => setName(e.target.value)} /></div>
<div className="field"><label>Tagline</label><input placeholder="Short tagline" value={tagline} onChange={e => setTagline(e.target.value)} /></div>
<div className="field"><label>Description *</label><textarea placeholder="Tell businesses who you are..." value={desc} onChange={e => setDesc(e.target.value)} /></div>
<div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:11 }}>
<div className="field"><label>Industry *</label><select value={ind} onChange={e => setInd(e.target.value)}><option value="">Select...</option>{INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}</select></div>
<div className="field"><label>Type</label><select value={type} onChange={e => setType(e.target.value)}><option value="B2B">B2B</option><option value="D2C">D2C</option><option value="B2B + D2C">B2B + D2C</option></select></div>
</div>
<div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:11 }}>
<div className="field"><label>City *</label><input placeholder="Dubai" value={city} onChange={e => setCity(e.target.value)} /></div>
<div className="field"><label>Country *</label><select value={country} onChange={e => setCountry(e.target.value)}><option value="">Select...</option>{COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
</div>
<div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:11 }}>
<div className="field"><label>Website</label><input placeholder="yoursite.com" value={website} onChange={e => setWebsite(e.target.value)} /></div>
<div className="field"><label>Founded</label><input placeholder="2020" value={founded} onChange={e => setFounded(e.target.value)} /></div>
</div>
{err && <div className="form-err">{err}</div>}
<div style={{ height:72 }} />
</div>
<div style={{ position:'sticky', bottom:0, zIndex:20, padding:'10px 16px calc(10px + env(safe-area-inset-bottom,0px))', background:'linear-gradient(to top, rgba(10,22,40,0.98) 70%, rgba(10,22,40,0))' }}>
<button className="btn btn-blue btn-full" onClick={save} disabled={saving}>{saving?'Saving...':existing?'Save Changes':'Create Profile'}</button>
</div>
</div>
)
}

// ── CONFERENCE PAGE ───────────────────────────────────────────────
function parseConferenceStart(c: Conference) {
  const [time, mer] = (c.time || '10:00 AM').split(' ')
  const [hhRaw, mmRaw] = (time || '10:00').split(':')
  let hh = Number(hhRaw || 10)
  const mm = Number(mmRaw || 0)
  if (mer === 'PM' && hh < 12) hh += 12
  if (mer === 'AM' && hh === 12) hh = 0
  const dt = new Date(c.date)
  dt.setHours(hh, mm, 0, 0)
  return dt
}

export function ConferencePage() {
const { myBiz, toast } = useApp()
const [confs, setConfs] = useState<Conference[]>([])
const [loading, setLoading] = useState(true)
const [view, setView] = useState<'list'|'book'|'create'>('list')
const [liveConf, setLiveConf] = useState<Conference|null>(null)
const [connections, setConnections] = useState<Business[]>([])
const [inviteModalConf, setInviteModalConf] = useState<Conference | null>(null)
const [sendingInviteTo, setSendingInviteTo] = useState<string | null>(null)
const [inviteAllBusy, setInviteAllBusy] = useState(false)

const load = useCallback(async () => {
  let usedCache = false
  try {
    const raw = sessionStorage.getItem(CONF_CACHE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as { t: number; rows: Conference[] }
      if (Date.now() - p.t < CONF_CACHE_MS && p.rows) {
        setConfs(p.rows)
        usedCache = true
        setLoading(false)
      }
    }
  } catch {
    /* ignore */
  }
  if (!usedCache) setLoading(true)
  const { data } = await sb.from('conferences').select('*,conference_attendees(business_id)').order('date', { ascending: true })
  const next = data || []
  setConfs(next)
  setLoading(false)
  try {
    sessionStorage.setItem(CONF_CACHE_KEY, JSON.stringify({ t: Date.now(), rows: next }))
  } catch {
    /* ignore */
  }
}, [])

useEffect(() => { load() }, [load])

useEffect(() => {
  if (!myBiz?.id) {
    setConnections([])
    return
  }
  let cancelled = false
  void (async () => {
    const { data: connRows, error } = await sb
      .from('connections')
      .select('from_biz_id,to_biz_id')
      .or(`from_biz_id.eq.${myBiz.id},to_biz_id.eq.${myBiz.id}`)
    if (cancelled || error || !connRows?.length) {
      if (!cancelled) setConnections([])
      return
    }
    const ids = Array.from(
      new Set(
        connRows
          .map((c) => otherConnectionBusinessId(c, myBiz.id))
          .filter((id): id is string => !!id && normalizeUuid(id) !== normalizeUuid(myBiz.id)),
      ),
    )
    if (!ids.length) {
      if (!cancelled) setConnections([])
      return
    }
    const connBiz = await fetchBusinessProfilesByIds(CONNECTIONS_CARD_SELECT, ids)
    if (!cancelled) setConnections(connBiz)
  })()
  return () => {
    cancelled = true
  }
}, [myBiz?.id])

useEffect(() => {
const ch = sb.channel('conf-updates').on('postgres_changes', { event:'*', schema:'public', table:'conference_attendees' }, load).subscribe()
return () => { sb.removeChannel(ch) }
}, [load])

const myConfs = confs.filter(c => c.status !== 'closed' && myBiz && c.conference_attendees?.some((a:any) => a.business_id === myBiz.id))
const avail = confs.filter(c => c.status !== 'closed' && (!myBiz || !c.conference_attendees?.some((a:any) => a.business_id === myBiz.id)))

const join = async (c: Conference) => {
if (!myBiz) { toast('Create a business profile first', 'info'); return }
if ((c.conference_attendees?.length||0) >= c.max_attendees) { toast('Session is full!', 'error'); return }
await sb.from('conference_attendees').insert({ conference_id:c.id, business_id:myBiz.id })
toast('Joined "' + c.title + '"!')
load()
}

const leave = async (c: Conference) => {
if (!myBiz) return
await sb.from('conference_attendees').delete().eq('conference_id', c.id).eq('business_id', myBiz.id)
toast('Left conference')
load()
}

const openLive = (c: Conference) => {
  if (c.status === 'closed') { toast('This conference is closed', 'info'); return }
  setLiveConf(c)
}

const ensureChat = async (a: string, b: string) => {
  const { data } = await sb.rpc('get_or_create_chat', { biz_a:a, biz_b:b })
  return data as string | null
}

const inviteableForModal =
  inviteModalConf && myBiz
    ? connections.filter((b) => {
        const att = new Set((inviteModalConf.conference_attendees || []).map((a: { business_id: string }) => a.business_id))
        return b.id !== myBiz.id && !att.has(b.id)
      })
    : []

const sendSessionInviteToConnection = async (conf: Conference, targetBizId: string) => {
  if (!myBiz) return { ok: false as const, error: 'No profile' }
  const markerFragment = `[CONF_SESSION_INVITE]:${conf.id}`
  const chatId = await ensureChat(myBiz.id, targetBizId)
  if (!chatId) return { ok: false as const, error: 'Could not open chat' }
  const { count } = await sb.from('messages').select('id', { count: 'exact', head: true }).eq('chat_id', chatId).ilike('text', `%${markerFragment}%`)
  if ((count || 0) > 0) return { ok: false as const, error: 'already_sent' }
  const { error } = await sb.from('messages').insert({
    chat_id: chatId,
    sender_id: myBiz.id,
    text: conferenceSessionInviteMessage(myBiz.name, conf),
  })
  if (error) return { ok: false as const, error: error.message }
  void notifySessionExternal(conf.id, targetBizId, myBiz.id, 'invite')
  return { ok: true as const }
}

const sendConferenceNotice = async (c: Conference, kind: 'MISSED'|'REMINDER') => {
  if (!myBiz || c.organizer_id !== myBiz.id) return
  const marker = `[CONF_${kind}:${c.id}]`
  const attendees = (c.conference_attendees || []).map((a:any) => a.business_id).filter((id: string) => id && id !== myBiz.id)
  for (const attendeeId of attendees) {
    const chatId = await ensureChat(myBiz.id, attendeeId)
    if (!chatId) continue
    const { count } = await sb.from('messages').select('id', { count:'exact', head:true }).eq('chat_id', chatId).ilike('text', `%${marker}%`)
    if ((count || 0) > 0) continue
    const text = kind === 'MISSED'
      ? `${marker} You missed the conference "${c.title}" scheduled on ${fmtDate(c.date)} at ${c.time}.`
      : `${marker} Reminder: "${c.title}" starts soon at ${c.time}. Please join on time.`
    const { error } = await sb.from('messages').insert({ chat_id:chatId, sender_id:myBiz.id, text })
    if (!error && kind === 'REMINDER') {
      void notifySessionExternal(c.id, attendeeId, myBiz.id, 'reminder')
    }
  }
}

const closeConference = async (c: Conference, automatic = false) => {
  if (!myBiz || c.organizer_id !== myBiz.id) return
  if (c.status === 'closed') return
  const { error } = await sb.from('conferences').update({ status:'closed' }).eq('id', c.id)
  if (error) { toast('Failed to close conference: ' + error.message, 'error'); return }
  await sendConferenceNotice(c, 'MISSED')
  if (!automatic) toast('Conference closed. Missed-call notices sent.')
  if (liveConf?.id === c.id) setLiveConf(null)
  load()
}

useEffect(() => {
  if (!myBiz || !confs.length) return
  const run = async () => {
    const now = new Date()
    for (const c of confs) {
      if (c.organizer_id !== myBiz.id || c.status === 'closed') continue
      const start = parseConferenceStart(c)
      const end = new Date(start.getTime() + 60 * 60 * 1000)
      // Auto close one hour after start time if still open.
      if (now > end) await closeConference(c, true)
      // Auto reminder in last 30 minutes before start.
      const minsToStart = (start.getTime() - now.getTime()) / 60000
      if (minsToStart > 0 && minsToStart <= 30) await sendConferenceNotice(c, 'REMINDER')
    }
  }
  run()
}, [confs, myBiz?.id])

if (view === 'book') return <BookForm onDone={() => { load(); setView('list'); toast('Conference booked!') }} onBack={() => setView('list')} />
if (view === 'create') return <CreateConfForm onDone={() => { load(); setView('list'); toast('Conference created!') }} onBack={() => setView('list')} />
if (liveConf && myBiz) return <ConferenceLiveRoom conference={liveConf} myBiz={myBiz} onBack={() => setLiveConf(null)} />

return (
<div style={{ paddingBottom:16 }}>
<div className="topbar">
<div className="page-title">Conferences</div>
{myBiz && <button className="btn btn-blue btn-sm" onClick={() => setView('create')}>+ Host</button>}
</div>
<div style={{ margin:'0 16px 15px', borderRadius:17, padding:'17px 17px 15px', background:'linear-gradient(135deg,#0C2340,#1A3D6E)', position:'relative', overflow:'hidden' }}>
<div style={{ fontFamily:'Syne, sans-serif', fontSize:16, fontWeight:800, marginBottom:5 }}>Live Business Networking</div>
<div style={{ fontSize:12, color:'rgba(255,255,255,0.6)', lineHeight:1.5, marginBottom:13 }}>Book a curated group session with up to 8 verified business owners.</div>
<button className="btn btn-blue btn-sm" onClick={() => setView('book')}>📅 Book Session</button>
</div>
{loading && <div style={{ display:'flex', justifyContent:'center', padding:'40px 0' }}><div className="spinner" /></div>}
{!loading && myConfs.length > 0 && (
<><div className="sec-hd"><h3>My Sessions</h3></div>
{myConfs.map(c => <ConfCard key={c.id} c={c} myBizId={myBiz?.id} joined onLeave={() => leave(c)} onGoLive={() => openLive(c)} onClose={() => closeConference(c)} onInviteConnections={() => setInviteModalConf(c)} />)}
<div style={{ height:8 }} /></>
)}
<div className="sec-hd"><h3>Available Sessions</h3><span className="see-all">{avail.length} open</span></div>
{!loading && avail.length === 0 && <div className="empty"><div className="ico">📅</div><h3>No sessions right now</h3>{myBiz && <button className="btn btn-accent btn-sm" style={{ marginTop:14 }} onClick={() => setView('create')}>+ Create one</button>}</div>}
{avail.map(c => <ConfCard key={c.id} c={c} myBizId={myBiz?.id} joined={false} onJoin={() => join(c)} onGoLive={() => openLive(c)} onClose={() => closeConference(c)} />)}

{inviteModalConf && myBiz && (
<div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.72)', zIndex:600, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={() => setInviteModalConf(null)} role="presentation">
  <div style={{ background:'#152236', borderRadius:16, border:'1px solid rgba(255,255,255,0.08)', maxWidth:380, width:'100%', maxHeight:'78vh', overflow:'hidden', display:'flex', flexDirection:'column' }} onClick={(e) => e.stopPropagation()}>
    <div style={{ padding:'14px 16px', borderBottom:'1px solid rgba(255,255,255,0.07)', display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
      <div>
        <div style={{ fontFamily:'Syne, sans-serif', fontWeight:800, fontSize:15 }}>Invite connections</div>
        <div style={{ fontSize:11, color:'#7A92B0', marginTop:4, lineHeight:1.35 }}>Sends in-app chat plus email (each business chooses in Profile).</div>
      </div>
      <button type="button" onClick={() => setInviteModalConf(null)} style={{ background:'none', border:'none', color:'#7A92B0', fontSize:22, cursor:'pointer', lineHeight:1, flexShrink:0 }} aria-label="Close">×</button>
    </div>
    <div style={{ fontSize:12, fontWeight:700, padding:'0 16px 10px', color:'#fff' }}>{inviteModalConf.title}</div>
    <div style={{ fontSize:10.5, color:'#7A92B0', padding:'0 16px 12px' }}>{fmtDate(inviteModalConf.date)} · {inviteModalConf.time}</div>
    <div style={{ flex:1, overflowY:'auto', padding:'0 16px 16px', minHeight:0 }}>
      {inviteableForModal.length === 0 ? (
        <div style={{ textAlign:'center', padding:'22px 8px', color:'#7A92B0', fontSize:13, lineHeight:1.5 }}>
          {connections.length === 0 ? 'No connections yet. Connect with businesses in the Feed, then invite them here.' : 'Everyone you are connected with is already in this session.'}
        </div>
      ) : (
        <>
          {inviteableForModal.map((b) => (
            <div key={b.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, padding:'11px 0', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ minWidth:0 }}>
                <div style={{ fontWeight:700, fontSize:13 }}>{b.name}</div>
                <div style={{ fontSize:10, color:'#7A92B0' }}>{b.industry} · {b.city}</div>
              </div>
              <button
                type="button"
                className="btn btn-blue btn-sm"
                style={{ flexShrink:0 }}
                disabled={sendingInviteTo === b.id}
                onClick={() => {
                  void (async () => {
                    if (!inviteModalConf) return
                    setSendingInviteTo(b.id)
                    const r = await sendSessionInviteToConnection(inviteModalConf, b.id)
                    setSendingInviteTo(null)
                    if (r.ok) toast('Invite sent to ' + b.name, 'success')
                    else if (r.error === 'already_sent') toast('Already invited ' + b.name, 'info')
                    else toast(r.error, 'error')
                  })()
                }}
              >
                {sendingInviteTo === b.id ? '…' : 'Send'}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-ghost btn-full btn-sm"
            style={{ marginTop:14 }}
            disabled={inviteAllBusy}
            onClick={() => {
              void (async () => {
                if (!inviteModalConf || inviteableForModal.length === 0) return
                setInviteAllBusy(true)
                let sent = 0
                let dup = 0
                for (const b of inviteableForModal) {
                  const r = await sendSessionInviteToConnection(inviteModalConf, b.id)
                  if (r.ok) sent++
                  else if (r.error === 'already_sent') dup++
                }
                setInviteAllBusy(false)
                toast(sent ? `Sent ${sent} invite${sent === 1 ? '' : 's'}` + (dup ? ` (${dup} already invited)` : '') : dup ? 'Everyone was already invited' : 'No invites sent', 'info')
              })()
            }}
          >
            {inviteAllBusy ? 'Sending…' : `Invite all (${inviteableForModal.length})`}
          </button>
        </>
      )}
    </div>
  </div>
</div>
)}
</div>
)
}

function ConfCard({
  c,
  myBizId,
  joined,
  onJoin,
  onLeave,
  onGoLive,
  onClose,
  onInviteConnections,
}: {
  c: Conference
  myBizId?: string | null
  joined: boolean
  onJoin?: () => void
  onLeave?: () => void
  onGoLive: () => void
  onClose: () => void
  onInviteConnections?: () => void
}) {
const atts = c.conference_attendees||[]
const spots = c.max_attendees - atts.length
const pct = (atts.length/c.max_attendees)*100
const days = Math.max(0, Math.ceil((new Date(c.date).getTime()-Date.now())/86400000))
const isMine = myBizId && c.organizer_id === myBizId
const closed = c.status === 'closed'
return (
<div style={{ margin:'0 16px 10px', background:'#152236', borderRadius:15, border:`1px solid ${closed?'rgba(255,75,110,0.35)':joined?'rgba(30,126,247,0.35)':'rgba(255,255,255,0.07)'}`, overflow:'hidden', opacity:closed?0.75:1 }}>
<div style={{ padding:'13px 13px 10px' }}>
<div style={{ display:'flex', alignItems:'flex-start', gap:11 }}>
<div style={{ width:42, height:42, borderRadius:11, background:'rgba(30,126,247,0.15)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:19, flexShrink:0 }}>{indEmoji(c.industry)}</div>
<div style={{ flex:1 }}>
<div style={{ display:'flex', alignItems:'center', gap:5, flexWrap:'wrap' }}>
<div style={{ fontFamily:'Syne, sans-serif', fontSize:13.5, fontWeight:700 }}>{c.title}</div>
{joined && <span style={{ fontSize:9, fontWeight:800, background:'#1E7EF7', color:'#fff', padding:'2px 5px', borderRadius:5 }}>JOINED</span>}
{isMine && <span style={{ fontSize:9, fontWeight:800, background:'#FF6B35', color:'#fff', padding:'2px 5px', borderRadius:5 }}>HOST</span>}
{closed && <span style={{ fontSize:9, fontWeight:800, background:'#FF4B6E', color:'#fff', padding:'2px 5px', borderRadius:5 }}>CLOSED</span>}
</div>
<div style={{ fontSize:10.5, color:'#7A92B0', marginTop:2 }}>{c.industry} · {c.location}</div>
<div style={{ fontSize:10.5, color:'#7A92B0', marginTop:1 }}>📅 {fmtDate(c.date)} at {c.time}</div>
</div>
<div style={{ textAlign:'right', flexShrink:0 }}>
<div style={{ fontFamily:'Syne, sans-serif', fontSize:16, fontWeight:800, color:days<=3?'#FF6B35':'#1E7EF7' }}>{days}d</div>
<div style={{ fontSize:9.5, color:'#7A92B0' }}>away</div>
</div>
</div>
<div style={{ marginTop:10 }}>
<div style={{ display:'flex', justifyContent:'space-between', marginBottom:4, fontSize:10.5 }}>
<span style={{ color:'#7A92B0' }}>{atts.length} / {c.max_attendees} attendees</span>
<span style={{ color:spots<=2?'#FF6B35':'#00D4A0', fontWeight:700 }}>{spots} spot{spots!==1?'s':''} left</span>
</div>
<div className="prog-wrap"><div className="prog-fill" style={{ width:pct+'%', background:pct>80?'#FF6B35':'#00D4A0' }} /></div>
</div>
</div>
{!closed && joined && onInviteConnections && (
<div style={{ padding:'0 13px 10px' }}>
<button type="button" className="btn btn-accent btn-full btn-sm" onClick={onInviteConnections}>Invite connections</button>
</div>
)}
<div style={{ padding:'0 13px 12px', display:'flex', gap:7 }}>
{!closed && !joined && !isMine && <button className="btn btn-blue btn-full btn-sm" onClick={onJoin}>Join - {spots} spots left</button>}
{!closed && joined && !isMine && <><button className="btn btn-ghost btn-sm" style={{ flex:1 }} onClick={onLeave}>Leave</button><button className="btn btn-blue btn-sm" style={{ flex:2 }} onClick={onGoLive}>Go Live</button></>}
{!closed && isMine && <><button className="btn btn-blue btn-sm" style={{ flex:2 }} onClick={onGoLive}>Start Live Session</button><button className="btn btn-red btn-sm" style={{ flex:1 }} onClick={onClose}>Close</button></>}
{closed && <button className="btn btn-ghost btn-full btn-sm" disabled>Conference Closed</button>}
</div>
</div>
)
}

type LiveSignal = {
  type: 'join'|'offer'|'answer'|'ice'|'leave'
  from: string
  to?: string
  bizName?: string
  bizId?: string
  payload?: any
}

function ConferenceLiveRoom({ conference, myBiz, onBack }: { conference: Conference; myBiz: Business; onBack: () => void }) {
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({})
  const [remoteNames, setRemoteNames] = useState<Record<string, string>>({})
  const [remoteBizIds, setRemoteBizIds] = useState<Record<string, string>>({})
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [starting, setStarting] = useState(true)
  const [ending, setEnding] = useState(false)
  const localVideoRef = useRef<HTMLVideoElement|null>(null)
  const localStreamRef = useRef<MediaStream|null>(null)
  const channelRef = useRef<any>(null)
  const peersRef = useRef<Record<string, RTCPeerConnection>>({})
  const peerIdRef = useRef<string>(`peer-${Date.now()}-${Math.random().toString(36).slice(2,8)}`)

  const cleanupPeer = useCallback((pid: string) => {
    const pc = peersRef.current[pid]
    if (pc) {
      pc.onicecandidate = null
      pc.ontrack = null
      pc.close()
      delete peersRef.current[pid]
    }
    setRemoteStreams(prev => {
      const next = { ...prev }
      delete next[pid]
      return next
    })
    setRemoteNames(prev => {
      const next = { ...prev }
      delete next[pid]
      return next
    })
    setRemoteBizIds(prev => {
      const next = { ...prev }
      delete next[pid]
      return next
    })
  }, [])

  const sendSignal = useCallback((sig: LiveSignal) => {
    const ch = channelRef.current
    if (!ch) return
    ch.send({ type:'broadcast', event:'signal', payload:sig })
  }, [])

  const createPeer = useCallback((targetPeerId: string) => {
    if (peersRef.current[targetPeerId]) return peersRef.current[targetPeerId]
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls:'stun:stun.l.google.com:19302' },
        { urls:'stun:stun1.l.google.com:19302' }
      ]
    })
    const local = localStreamRef.current
    if (local) local.getTracks().forEach(track => pc.addTrack(track, local))
    pc.ontrack = (e) => {
      const stream = e.streams?.[0]
      if (!stream) return
      setRemoteStreams(prev => ({ ...prev, [targetPeerId]: stream }))
    }
    pc.onicecandidate = (e) => {
      if (!e.candidate) return
      sendSignal({ type:'ice', from:peerIdRef.current, to:targetPeerId, payload:e.candidate })
    }
    peersRef.current[targetPeerId] = pc
    return pc
  }, [sendSignal])

  useEffect(() => {
    let mounted = true
    const room = `conf-live-${conference.id}`
    const setup = async () => {
      try {
        const local = await navigator.mediaDevices.getUserMedia({ audio:true, video:{ facingMode:'user' } })
        if (!mounted) {
          local.getTracks().forEach(t => t.stop())
          return
        }
        localStreamRef.current = local
        if (localVideoRef.current) localVideoRef.current.srcObject = local

        const ch = sb.channel(room)
          .on('broadcast', { event:'signal' }, async ({ payload }: { payload: LiveSignal }) => {
            const msg = payload
            if (!msg || msg.from === peerIdRef.current) return
            if (msg.to && msg.to !== peerIdRef.current) return
            if (msg.bizName) setRemoteNames(prev => ({ ...prev, [msg.from]: msg.bizName || 'Guest' }))
            if (msg.bizId) setRemoteBizIds(prev => ({ ...prev, [msg.from]: msg.bizId }))

            if (msg.type === 'join') {
              const pc = createPeer(msg.from)
              const offer = await pc.createOffer()
              await pc.setLocalDescription(offer)
              sendSignal({ type:'offer', from:peerIdRef.current, to:msg.from, payload:offer, bizName:myBiz.name, bizId:myBiz.id })
            }

            if (msg.type === 'offer') {
              const pc = createPeer(msg.from)
              await pc.setRemoteDescription(new RTCSessionDescription(msg.payload))
              const answer = await pc.createAnswer()
              await pc.setLocalDescription(answer)
              sendSignal({ type:'answer', from:peerIdRef.current, to:msg.from, payload:answer, bizName:myBiz.name, bizId:myBiz.id })
            }

            if (msg.type === 'answer') {
              const pc = createPeer(msg.from)
              await pc.setRemoteDescription(new RTCSessionDescription(msg.payload))
            }

            if (msg.type === 'ice') {
              const pc = createPeer(msg.from)
              if (msg.payload) await pc.addIceCandidate(new RTCIceCandidate(msg.payload))
            }

            if (msg.type === 'leave') cleanupPeer(msg.from)
          })
          .subscribe((status: string) => {
            if (status === 'SUBSCRIBED') {
              sendSignal({ type:'join', from:peerIdRef.current, bizName:myBiz.name, bizId:myBiz.id })
              setStarting(false)
            }
          })

        channelRef.current = ch
      } catch {
        setStarting(false)
      }
    }

    setup()
    return () => {
      mounted = false
      sendSignal({ type:'leave', from:peerIdRef.current })
      const ch = channelRef.current
      if (ch) sb.removeChannel(ch)
      Object.keys(peersRef.current).forEach(cleanupPeer)
      const local = localStreamRef.current
      if (local) local.getTracks().forEach(t => t.stop())
      localStreamRef.current = null
      channelRef.current = null
    }
  }, [conference.id, createPeer, cleanupPeer, myBiz.name, sendSignal])

  const toggleMic = () => {
    const local = localStreamRef.current
    if (!local) return
    const next = !micOn
    local.getAudioTracks().forEach(t => { t.enabled = next })
    setMicOn(next)
  }

  const toggleCam = () => {
    const local = localStreamRef.current
    if (!local) return
    const next = !camOn
    local.getVideoTracks().forEach(t => { t.enabled = next })
    setCamOn(next)
  }

  const remotes = Object.entries(remoteStreams)

  const leaveRoom = async () => {
    if (ending) return
    setEnding(true)
    try {
      const dateKey = new Date().toISOString().slice(0, 10)
      const marker = `[CONF_CALL_HISTORY:${conference.id}:${dateKey}]`
      const ids = Array.from(new Set(Object.values(remoteBizIds).filter(id => id && id !== myBiz.id)))
      const names = Array.from(new Set(Object.entries(remoteBizIds).map(([peer, id]) => ({ id, name: remoteNames[peer] || 'Business' })).filter(x => x.id && x.id !== myBiz.id).map(x => x.name)))
      if (ids.length) {
        for (const pid of ids) {
          const { data: chatId } = await sb.rpc('get_or_create_chat', { biz_a:myBiz.id, biz_b:pid })
          if (!chatId) continue
          const { count } = await sb.from('messages').select('id', { count:'exact', head:true }).eq('chat_id', chatId).ilike('text', `%${marker}%`)
          if ((count || 0) > 0) continue
          const text = `${marker} Conference call summary (${fmtDate(new Date().toISOString())}): You were on call with ${names.join(', ')}. You can choose to connect with them if you'd like.`
          await sb.from('messages').insert({ chat_id:chatId, sender_id:myBiz.id, text })
        }
      }
    } finally {
      onBack()
    }
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <div style={{ display:'flex', alignItems:'center', gap:11, padding:'11px 15px 9px', borderBottom:'1px solid rgba(255,255,255,0.07)', flexShrink:0 }}>
        <button onClick={leaveRoom} style={{ background:'none', border:'none', color:'#7A92B0', fontSize:20, cursor:'pointer', padding:'2px 5px', flexShrink:0 }}>←</button>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:'Syne, sans-serif', fontSize:14, fontWeight:700, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>🔴 Live: {conference.title}</div>
          <div style={{ fontSize:10.5, color:'#7A92B0' }}>{conference.industry} · {conference.location}</div>
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:12 }}>
        {starting && <div style={{ fontSize:12, color:'#7A92B0', marginBottom:8 }}>Starting camera and joining live room…</div>}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(2, minmax(0,1fr))', gap:9 }}>
          <div style={{ background:'#152236', border:'1px solid rgba(255,255,255,0.07)', borderRadius:12, overflow:'hidden' }}>
            <video ref={localVideoRef} autoPlay muted playsInline style={{ width:'100%', height:140, objectFit:'cover' }} />
            <div style={{ padding:'6px 8px', fontSize:11, fontWeight:700 }}>You ({myBiz.name})</div>
          </div>
          {remotes.map(([pid, stream]) => (
            <div key={pid} style={{ background:'#152236', border:'1px solid rgba(255,255,255,0.07)', borderRadius:12, overflow:'hidden' }}>
              <video autoPlay playsInline style={{ width:'100%', height:140, objectFit:'cover' }} ref={el => { if (el && el.srcObject !== stream) el.srcObject = stream }} />
              <div style={{ padding:'6px 8px', fontSize:11, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{remoteNames[pid] || 'Guest'}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding:'10px 12px calc(10px + env(safe-area-inset-bottom,0px))', borderTop:'1px solid rgba(255,255,255,0.07)', display:'flex', gap:8 }}>
        <button className="btn btn-ghost" style={{ flex:1 }} onClick={toggleMic}>{micOn ? '🎤 Mic On' : '🔇 Mic Off'}</button>
        <button className="btn btn-ghost" style={{ flex:1 }} onClick={toggleCam}>{camOn ? '📷 Cam On' : '📷 Cam Off'}</button>
        <button className="btn btn-red" style={{ flex:1 }} onClick={leaveRoom} disabled={ending}>{ending ? 'Saving…' : 'Leave'}</button>
      </div>
    </div>
  )
}

function BookForm({ onDone, onBack }: any) {
const { myBiz, toast } = useApp()
const [day, setDay] = useState(10)
const [time, setTime] = useState('10:00 AM')
const [ind, setInd] = useState('')
const [loc, setLoc] = useState('')
const [saving, setSaving] = useState(false)
const SLOTS = [8,10,15,18,23,25]
const CAL = [null,null,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30]
const book = async () => {
if (!myBiz) { toast('Create a business profile first', 'info'); return }
setSaving(true)
const location = loc || myBiz.city+', '+myBiz.country
const { data:conf } = await sb.from('conferences').insert({ organizer_id:myBiz.id, title:(ind||'Business')+' Networking - '+myBiz.city, date:'2026-06-'+String(day).padStart(2,'0'), time, industry:ind||'General', location, max_attendees:8 }).select().single()
if (conf) await sb.from('conference_attendees').insert({ conference_id:conf.id, business_id:myBiz.id })
setSaving(false); onDone()
}
return (
<div style={{ paddingBottom:20 }}>
<div className="topbar"><button onClick={onBack} style={{ background:'none', border:'none', color:'#7A92B0', fontSize:16, cursor:'pointer', padding:'4px 8px' }}>← Back</button><div className="page-title">Book a Session</div><div style={{ width:60 }} /></div>
<div style={{ padding:'0 16px' }}>
<div style={{ display:'flex', gap:10, marginBottom:17 }}>
<div className="field" style={{ flex:1, marginBottom:0 }}><label>Industry</label><select value={ind} onChange={e => setInd(e.target.value)}><option value="">All</option>{INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}</select></div>
<div className="field" style={{ flex:1, marginBottom:0 }}><label>Location</label><input placeholder="City, Country" value={loc} onChange={e => setLoc(e.target.value)} /></div>
</div>
<div style={{ background:'#152236', borderRadius:15, padding:15, border:'1px solid rgba(255,255,255,0.07)', marginBottom:15 }}>
<div style={{ fontFamily:'Syne, sans-serif', fontSize:14, fontWeight:700, marginBottom:13 }}>June 2026</div>
<div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:3 }}>
{['S','M','T','W','T','F','S'].map((d,i) => <div key={i} style={{ textAlign:'center', fontSize:9.5, fontWeight:700, color:'#3A5070', padding:'3px 0' }}>{d}</div>)}
{CAL.map((d,i) => {
if (!d) return <div key={i} />
const isSel = day===d, isSlot = SLOTS.includes(d)
return <div key={i} onClick={() => setDay(d)} style={{ textAlign:'center', padding:'7px 2px', borderRadius:7, fontSize:11.5, cursor:'pointer', background:isSel?'#1E7EF7':'transparent', color:isSel?'#fff':isSlot?'#1E7EF7':'#7A92B0', fontWeight:isSlot||isSel?700:400, position:'relative' }}>{d}{isSlot&&!isSel&&<div style={{ position:'absolute', bottom:1, left:'50%', transform:'translateX(-50%)', width:4, height:4, background:'#00D4A0', borderRadius:'50%' }} />}</div>
})}
</div>
</div>
<div style={{ display:'flex', gap:7, flexWrap:'wrap', marginBottom:16 }}>
{TIMES.map(t => <div key={t} onClick={() => setTime(t)} style={{ padding:'7px 13px', borderRadius:9, border:`1.5px solid ${time===t?'#1E7EF7':'rgba(255,255,255,0.07)'}`, fontSize:11.5, fontWeight:600, color:time===t?'#fff':'#7A92B0', background:time===t?'#1E7EF7':'#152236', cursor:'pointer' }}>{t}</div>)}
</div>
<button className="btn btn-blue btn-full" onClick={book} disabled={saving}>{saving?'Booking...':'Book Conference Session'}</button>
</div>
</div>
)
}

function CreateConfForm({ onDone, onBack }: any) {
const { myBiz, toast } = useApp()
const [title, setTitle] = useState('')
const [date, setDate] = useState('')
const [time, setTime] = useState('10:00 AM')
const [ind, setInd] = useState('')
const [loc, setLoc] = useState(myBiz ? myBiz.city+', '+myBiz.country : '')
const [saving, setSaving] = useState(false)
const create = async () => {
if (!myBiz || !title || !date) { toast('Title and date required', 'error'); return }
setSaving(true)
const { data:conf } = await sb.from('conferences').insert({ organizer_id:myBiz.id, title, date, time, industry:ind||'General', location:loc||myBiz.city, max_attendees:8 }).select().single()
if (conf) await sb.from('conference_attendees').insert({ conference_id:conf.id, business_id:myBiz.id })
setSaving(false); onDone()
}
return (
<div style={{ paddingBottom:20 }}>
<div className="topbar"><button onClick={onBack} style={{ background:'none', border:'none', color:'#7A92B0', fontSize:16, cursor:'pointer', padding:'4px 8px' }}>← Back</button><div className="page-title">Host a Conference</div><div style={{ width:60 }} /></div>
<div style={{ padding:'0 16px' }}>
<div className="field"><label>Session Title *</label><input placeholder="e.g. MENA Tech Founders Meetup" value={title} onChange={e => setTitle(e.target.value)} /></div>
<div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:11 }}>
<div className="field"><label>Date *</label><input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
<div className="field"><label>Industry</label><select value={ind} onChange={e => setInd(e.target.value)}><option value="">All</option>{INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}</select></div>
</div>
<div className="field"><label>Location</label><input placeholder="City, Country" value={loc} onChange={e => setLoc(e.target.value)} /></div>
<div style={{ display:'flex', gap:7, flexWrap:'wrap', marginBottom:16 }}>
{TIMES.map(t => <div key={t} onClick={() => setTime(t)} style={{ padding:'7px 13px', borderRadius:9, border:`1.5px solid ${time===t?'#1E7EF7':'rgba(255,255,255,0.07)'}`, fontSize:11.5, fontWeight:600, color:time===t?'#fff':'#7A92B0', background:time===t?'#1E7EF7':'#152236', cursor:'pointer' }}>{t}</div>)}
</div>
<button className="btn btn-blue btn-full" onClick={create} disabled={saving||!title||!date}>{saving?'Creating...':'Create Conference'}</button>
</div>
</div>
)
}

// ── GO RANDOM ─────────────────────────────────────────────────────
const RANDOM_POOL_SELECT =
  'id,name,type,industry,city,country,kyc_verified,trust_score'

export function GoRandomPage() {
const { myBiz, toast, pendingRandomCallFromBusinessId, clearPendingRandomCall } = useApp()
const [pool, setPool] = useState<Business[]>([])
const [poolLoading, setPoolLoading] = useState(true)
const [idx, setIdx] = useState(0)
const [sessions, setSessions] = useState(0)
const [connected, setConnected] = useState<Set<string>>(new Set())
const [fading, setFading] = useState(false)
const [activeCallWith, setActiveCallWith] = useState<Business|null>(null)
const [incomingCallFrom, setIncomingCallFrom] = useState<Business|null>(null)
const callAlertTimerRef = useRef<number | null>(null)

useEffect(() => {
  if (!myBiz) return
  let cancelled = false
  setPoolLoading(true)
  void sb
    .from('businesses')
    .select(RANDOM_POOL_SELECT)
    .neq('id', myBiz.id)
    .then(({ data, error }) => {
      if (cancelled) return
      setPool((data as Business[]) || [])
      setPoolLoading(false)
      if (error) console.warn('GoRandom pool:', error.message)
    })
  return () => {
    cancelled = true
  }
}, [myBiz?.id])

useEffect(() => {
  if (!myBiz) return
  sb.from('connections')
    .select('from_biz_id,to_biz_id')
    .or(`from_biz_id.eq.${myBiz.id},to_biz_id.eq.${myBiz.id}`)
    .then(({ data }) => {
      const ids = new Set<string>()
      ;(data || []).forEach((c: { from_biz_id: string; to_biz_id: string }) => {
        const otherId = otherConnectionBusinessId(c, myBiz.id)
        if (otherId && normalizeUuid(otherId) !== normalizeUuid(myBiz.id)) ids.add(normalizeUuid(otherId))
      })
      setConnected(ids)
    })
}, [myBiz?.id])

useEffect(() => {
  if (!myBiz) return
  const sinceIso = new Date(Date.now() - (10 * 60 * 1000)).toISOString()
  const loadRecentInvite = async () => {
    const { data: chats } = await sb.from('chats').select('id').or(`participant_a.eq.${myBiz.id},participant_b.eq.${myBiz.id}`)
    const chatIds = (chats || []).map((c: { id: string }) => c.id)
    if (!chatIds.length) return
    const { data: recent } = await sb
      .from('messages')
      .select('sender_id,text,created_at')
      .in('chat_id', chatIds)
      .neq('sender_id', myBiz.id)
      .gte('created_at', sinceIso)
      .ilike('text', `%${RANDOM_CALL_INVITE_MARKER}%`)
      .order('created_at', { ascending:false })
      .limit(1)
    const latest = recent?.[0]
    if (!latest?.sender_id || !latest.text?.includes('is calling you')) return
    const known = pool.find((b) => b.id === latest.sender_id) || null
    if (known) setIncomingCallFrom(known)
    else {
      const { data } = await sb.from('businesses').select('*').eq('id', latest.sender_id).single()
      if (data) setIncomingCallFrom(data as Business)
    }
  }
  loadRecentInvite()
}, [myBiz?.id, pool])

useEffect(() => {
  if (!myBiz || !pendingRandomCallFromBusinessId) return
  let cancelled = false
  const sid = pendingRandomCallFromBusinessId
  ;(async () => {
    const known = pool.find((b) => b.id === sid) || null
    if (known) {
      if (!cancelled) {
        setIncomingCallFrom(known)
        clearPendingRandomCall()
      }
      return
    }
    const { data } = await sb.from('businesses').select('*').eq('id', sid).single()
    if (!cancelled && data) {
      setIncomingCallFrom(data as Business)
      clearPendingRandomCall()
    }
  })()
  return () => { cancelled = true }
}, [myBiz?.id, pendingRandomCallFromBusinessId, pool, clearPendingRandomCall])

useEffect(() => {
  if (!incomingCallFrom) {
    if (callAlertTimerRef.current) {
      window.clearInterval(callAlertTimerRef.current)
      callAlertTimerRef.current = null
    }
    return
  }
  if (callAlertTimerRef.current) window.clearInterval(callAlertTimerRef.current)
  callAlertTimerRef.current = window.setInterval(() => {
    vibrateIfEnabled(120)
  }, 1800)
  return () => {
    if (callAlertTimerRef.current) {
      window.clearInterval(callAlertTimerRef.current)
      callAlertTimerRef.current = null
    }
  }
}, [incomingCallFrom])

const match = pool.length ? pool[idx % pool.length] : null
const next = () => {
  if (!pool.length) return
  setFading(true)
  setTimeout(() => { setIdx(i => i+1); setSessions(s => Math.min(3,s+1)); setFading(false) }, 200)
}
const connect = () => {
if (!myBiz || !match) { toast('Create a profile first', 'info'); return }
if (connected.has(normalizeUuid(match.id))) { toast('Already connected!', 'info'); return }
sb.from('connections').insert({ from_biz_id:myBiz.id, to_biz_id:match.id }).then(({ error }) => {
  if (error) {
    const msg = (error.message || '').toLowerCase()
    if (msg.includes('duplicate') || msg.includes('unique')) {
      setConnected((s) => new Set([...s, normalizeUuid(match.id)]))
      toast('Already connected!', 'info')
      return
    }
    toast('Failed to connect: ' + error.message, 'error')
    return
  }
  sb.rpc('get_or_create_chat', { biz_a:myBiz.id, biz_b:match.id }).then(() => {})
  setConnected((s) => new Set([...s, normalizeUuid(match.id)]))
  toast('Connected with ' + match.name + '!')
})
}

const startRandomCall = async () => {
  if (!myBiz || !match) { toast('No match found yet', 'info'); return }
  const { data: chatId } = await sb.rpc('get_or_create_chat', { biz_a:myBiz.id, biz_b:match.id })
  if (!chatId) { toast('Could not start call invite', 'error'); return }
  await sb.from('messages').insert({
    chat_id: chatId,
    sender_id: myBiz.id,
    read: false,
    text: randomCallInviteMessageRinging(myBiz.name)
  })
  await sendPushNotification({
    recipientBusinessId: match.id,
    senderBusinessId: myBiz.id,
    title: `${myBiz.name} is calling`,
    body: 'Incoming video call in Random.',
    tag: `random-call-${chatId}`,
    url: '/?tab=random',
  })
  toast(`Calling ${match.name}...`, 'info')
  setActiveCallWith(match)
}

if (!myBiz) return <div className="empty"><div className="ico">🎲</div><h3>Go Random</h3><p>Create a business profile to start random video calls.</p></div>
if (poolLoading) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'48px 16px', minHeight:220 }}>
      <div className="spinner" />
      <div style={{ marginTop:14, fontSize:12, color:'#7A92B0' }}>Finding businesses…</div>
    </div>
  )
}
if (!match) return <div className="empty"><div className="ico">🎲</div><h3>No businesses available</h3><p>Ask more businesses to join Bizzkit to start random calls.</p></div>
if (activeCallWith) return <RandomCallRoom myBiz={myBiz} other={activeCallWith} onEnd={() => setActiveCallWith(null)} />

return (
<div style={{ display:'flex', flexDirection:'column', height:'100%', minHeight:0, overflow:'hidden' }}>
{incomingCallFrom && (
  <div style={{ margin:'0 12px 8px', flexShrink:0, background:'rgba(30,126,247,0.15)', border:'1px solid rgba(30,126,247,0.45)', borderRadius:12, padding:'10px 11px' }}>
    <div style={{ fontFamily:'Syne, sans-serif', fontSize:12.5, fontWeight:700, marginBottom:3 }}>📞 Incoming Call</div>
    <div style={{ fontSize:11, color:'#7A92B0', marginBottom:8 }}>{incomingCallFrom.name} is calling you in Random.</div>
    <div style={{ display:'flex', gap:8 }}>
      <button className="btn btn-green btn-sm" style={{ flex:1 }} onClick={() => {
        setActiveCallWith(incomingCallFrom)
        setIncomingCallFrom(null)
        clearPendingRandomCall()
        if (callAlertTimerRef.current) {
          window.clearInterval(callAlertTimerRef.current)
          callAlertTimerRef.current = null
        }
      }}>Accept</button>
      <button className="btn btn-ghost btn-sm" style={{ flex:1 }} onClick={() => {
        void markLatestRandomCallInviteAsMissed(myBiz.id, incomingCallFrom.id)
        setIncomingCallFrom(null)
        clearPendingRandomCall()
        if (callAlertTimerRef.current) {
          window.clearInterval(callAlertTimerRef.current)
          callAlertTimerRef.current = null
        }
      }}>Decline</button>
    </div>
  </div>
)}
<div style={{ flex:1, minHeight:0, overflowY:'auto', overflowX:'hidden', WebkitOverflowScrolling:'touch' }}>
<div className="topbar" style={{ paddingTop:4, paddingBottom:6 }}><div className="page-title">🎲 Go Random</div><div style={{ fontSize:10.5, color:'#7A92B0' }}>Speed networking</div></div>
<div style={{ textAlign:'center', padding:'0 14px 8px', fontSize:11, color:'#7A92B0', lineHeight:1.45 }}>Match with businesses and start a video call.</div>
<div style={{ margin:'0 12px 8px', background:'#1A2D47', borderRadius:14, padding:'10px 12px', border:'1px solid rgba(255,255,255,0.07)', transition:'opacity .2s', opacity:fading?0:1 }}>
<div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:6, marginBottom:10 }}>
<div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:3, flex:1, minWidth:0 }}>
<div style={{ width:48, height:48, borderRadius:'50%', background:'rgba(30,126,247,0.2)', border:'2px solid #1E7EF7', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20 }}>{myBiz?logoText(myBiz.name).slice(0,1):'👤'}</div>
<div style={{ fontFamily:'Syne, sans-serif', fontSize:10, fontWeight:700, textAlign:'center' }}>You</div>
<div style={{ fontSize:9.5, color:'#7A92B0', textAlign:'center', maxWidth:'100%', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{myBiz?.name||'Your Business'}</div>
</div>
<div style={{ width:28, height:28, borderRadius:'50%', background:'#0A1628', border:'1px solid rgba(255,255,255,0.07)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:800, color:'#7A92B0', flexShrink:0 }}>VS</div>
<div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:3, flex:1, minWidth:0 }}>
<div style={{ width:48, height:48, borderRadius:'50%', background:'rgba(255,107,53,0.15)', border:'2px solid #FF6B35', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20 }} className={!connected.has(normalizeUuid(match.id))?'pulse':''}>{logoText(match.name).slice(0,1)}</div>
<div style={{ fontFamily:'Syne, sans-serif', fontSize:10, fontWeight:700, textAlign:'center', maxWidth:'100%', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{match.name}</div>
<div style={{ fontSize:9.5, color:'#7A92B0', textAlign:'center', lineHeight:1.2 }}>{match.type} · {match.industry}</div>
</div>
</div>
<div style={{ background:'#0A1628', borderRadius:10, padding:'8px 10px' }}>
<div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
<div style={{ minWidth:0 }}>
<div style={{ display:'flex', alignItems:'center', gap:4, marginBottom:4 }}>
{match.kyc_verified ? <><span className="kyc-dot" /><span style={{ fontSize:10, fontWeight:700, color:'#00D4A0' }}>KYC Verified</span></> : <span style={{ fontSize:10, color:'#3A5070' }}>Not verified</span>}
</div>
<div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
{[match.industry, match.type].filter(Boolean).map(t => <span key={t} style={{ background:'rgba(30,126,247,0.12)', color:'#4D9DFF', fontSize:9, fontWeight:600, padding:'2px 6px', borderRadius:5 }}>{t}</span>)}
</div>
<div style={{ fontSize:10, color:'#7A92B0', marginTop:4 }}>📍 {match.city}, {match.country}</div>
</div>
<div style={{ textAlign:'right', flexShrink:0 }}>
<div style={{ fontFamily:'Syne, sans-serif', fontSize:18, fontWeight:800, color:tierColor(tier(match.trust_score||0)) }}>{match.trust_score||0}</div>
<div style={{ fontSize:9, color:'#7A92B0' }}>Trust</div>
</div>
</div>
</div>
</div>
<div style={{ display:'flex', gap:8, padding:'0 12px', marginBottom:8 }}>
<button className="btn btn-ghost" style={{ flex:1, padding:'9px 8px', fontSize:12 }} onClick={next}>→ Next</button>
<button className="btn btn-green" style={{ flex:1.4, padding:'9px 8px', fontSize:12 }} onClick={startRandomCall}>Start Call</button>
</div>
<div style={{ padding:'0 12px', marginBottom:8 }}>
<button className="btn btn-blue btn-full btn-sm" style={{ padding:'9px' }} onClick={connect} disabled={connected.has(normalizeUuid(match.id))}>{connected.has(normalizeUuid(match.id))?'✓ Connected':'Connect ✓'}</button>
</div>
<div style={{ margin:'0 12px 10px', background:'#152236', borderRadius:10, padding:'8px 11px', border:'1px solid rgba(255,255,255,0.07)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
<div>
<div style={{ fontSize:11, fontWeight:700, marginBottom:3 }}>Sessions</div>
<div style={{ display:'flex', gap:4 }}>{Array.from({length:3}).map((_,i) => <div key={i} style={{ width:22, height:6, borderRadius:3, background:i<sessions?'#3A5070':'#00D4A0' }} />)}</div>
</div>
<div style={{ textAlign:'right' }}>
<div style={{ fontSize:10, color:'#7A92B0' }}>{sessions} viewed</div>
<div style={{ fontSize:10, color:'#1E7EF7', fontWeight:700, cursor:'pointer', marginTop:2 }} onClick={() => toast('Upgrade for unlimited sessions!','info')}>Upgrade →</div>
</div>
</div>
</div>
</div>
)
}

function RandomCallRoom({ myBiz, other, onEnd }: { myBiz: Business; other: Business; onEnd: () => void }) {
  /** Full sorted pair id (no truncation) — slice(0,36) could collide and mix signaling between different pairs. */
  const pairId = [myBiz.id, other.id]
    .sort()
    .map((id) => id.replace(/-/g, ''))
    .join('')
  const room = `random-${pairId}`
  return (
    <PeerVideoCall
      myBiz={myBiz}
      other={other}
      signalingChannelId={room}
      onEnd={onEnd}
      onEndWithoutRemote={() => markLatestRandomCallInviteAsMissed(myBiz.id, other.id)}
      headerEmoji="🎲"
    />
  )
}

// ── TRUST PAGE ────────────────────────────────────────────────────
export function TrustPage({ onOpenKyc }: { onOpenKyc?: ()=>void }) {
const { myBiz, refreshBiz, toast } = useApp()
const [certModal, setCertModal] = useState(false)
const [hasApprovedKyc, setHasApprovedKyc] = useState(false)
if (!myBiz) return <div className="empty"><div className="ico">🛡️</div><h3>Trust & Verification</h3><p>Create a business profile to build your Trust Score.</p></div>

useEffect(() => {
  let mounted = true
  const loadKycStatus = async () => {
    const { count } = await sb
      .from('kyc_submissions')
      .select('id', { count:'exact', head:true })
      .eq('business_id', myBiz.id)
      .eq('status', 'approved')
    const approved = (count || 0) > 0
    if (!mounted) return
    setHasApprovedKyc(approved)

    // Self-heal legacy false positives from old instant-verify behavior.
    if (myBiz.kyc_verified !== approved) {
      await sb.from('businesses').update({ kyc_verified:approved }).eq('id', myBiz.id)
      await refreshBiz()
    }
  }
  loadKycStatus()
  return () => { mounted = false }
}, [myBiz.id])

const nextThresh = myBiz.trust_score<50?50:myBiz.trust_score<75?75:myBiz.trust_score<90?90:100
const nextName = nextThresh===50?'Silver':nextThresh===75?'Gold':nextThresh===90?'Platinum':'Max'

const doCert = async () => {
const ns = Math.min(100, myBiz.trust_score+12)
await sb.from('businesses').update({ certified:true, trust_score:ns, trust_tier:tier(ns) }).eq('id', myBiz.id)
await refreshBiz(); setCertModal(false); toast('🏅 Certified! +12 Trust Score')
}

const breakdown = [
{ label:'Profile Completeness', pct:myBiz.description&&myBiz.tagline?95:60 },
{ label:'KYC Verified', pct:hasApprovedKyc?100:0 },
{ label:'Business Certified', pct:myBiz.certified?100:0 },
{ label:'Products Listed', pct:Math.min(100,(myBiz.products?.length||0)*20) },
]

const tiers = [
{ name:'Bronze', range:'0-49', icon:'🥉' },
{ name:'Silver', range:'50-74', icon:'🥈' },
{ name:'Gold', range:'75-89', icon:'🥇' },
{ name:'Platinum', range:'90-100', icon:'💎' },
]

const boosts = [
{ icon:'📝', label:'Complete your profile', pts:5, action:null, done:!!(myBiz.description&&myBiz.tagline) },
{ icon:'🪪', label:'KYC Verification', pts:15, action:() => onOpenKyc?.(), done:hasApprovedKyc },
{ icon:'🏅', label:'Business Certification ($19.99)', pts:12, action:() => setCertModal(true), done:myBiz.certified },
{ icon:'📦', label:'Add 5+ products', pts:10, action:null, done:(myBiz.products?.length||0)>=5 },
]

return (
<div style={{ paddingBottom:16 }}>
{certModal && (
<div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.8)', zIndex:500, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
<div style={{ background:'#1A2D47', borderRadius:18, padding:22, border:'1px solid rgba(255,255,255,0.07)', width:'100%' }}>
<div style={{ fontFamily:'Syne, sans-serif', fontSize:17, fontWeight:800, marginBottom:8 }}>🏅 Business Certification</div>
<div style={{ fontSize:13, color:'#7A92B0', marginBottom:18, lineHeight:1.6 }}>Enhanced verification of your company registration.<br /><br /><span style={{ color:'#fff', fontWeight:700 }}>One-time fee: $19.99</span></div>
<div style={{ display:'flex', gap:9 }}>
<button className="btn btn-ghost" style={{ flex:1 }} onClick={() => setCertModal(false)}>Cancel</button>
<button className="btn btn-blue" style={{ flex:1 }} onClick={doCert}>Pay & Certify</button>
</div>
</div>
</div>
)}
<div className="topbar"><div className="page-title">Trust & Verification</div></div>
<div style={{ margin:'0 16px 15px', borderRadius:18, padding:18, background:'linear-gradient(135deg,#0C2340,#1A3D6E)', position:'relative', overflow:'hidden' }}>
<div style={{ display:'flex', alignItems:'center', gap:13, position:'relative', zIndex:1 }}>
<div style={{ width:50, height:50, borderRadius:13, background:'linear-gradient(135deg,#1E7EF7,#6C63FF)', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Syne, sans-serif', fontWeight:800, fontSize:17, color:'#fff', flexShrink:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{logoText(myBiz.name)}</div>
<div style={{ flex:1 }}>
<div style={{ fontFamily:'Syne, sans-serif', fontSize:42, fontWeight:800, color:'#1E7EF7', lineHeight:1 }}>{myBiz.trust_score}</div>
<div style={{ fontSize:11, color:'rgba(255,255,255,0.5)', marginTop:1 }}>Your Trust Score</div>
</div>
<div style={{ padding:'6px 11px', borderRadius:9, background:'rgba(245,166,35,0.2)', color:tierColor(myBiz.trust_tier), fontSize:12, fontWeight:700, flexShrink:0 }}>{tierIcon(myBiz.trust_tier)} {myBiz.trust_tier}</div>
</div>
{myBiz.trust_score < 100 && (
<div style={{ marginTop:13, position:'relative', zIndex:1 }}>
<div style={{ height:5, background:'rgba(255,255,255,0.1)', borderRadius:3, overflow:'hidden' }}>
<div style={{ height:'100%', width:(myBiz.trust_score/nextThresh*100)+'%', background:'#1E7EF7', borderRadius:3 }} />
</div>
<div style={{ display:'flex', justifyContent:'space-between', marginTop:3, fontSize:9.5, color:'rgba(255,255,255,0.3)' }}><span>0</span><span>+{nextThresh-myBiz.trust_score} pts to {nextName}</span><span>{nextThresh}</span></div>
</div>
)}
</div>
<div className="sec-hd"><h3>Score Breakdown</h3></div>
<div style={{ padding:'0 16px', marginBottom:14 }}>
{breakdown.map(item => (
<div key={item.label} style={{ marginBottom:11 }}>
<div style={{ display:'flex', justifyContent:'space-between', marginBottom:4, fontSize:12 }}>
<span style={{ fontWeight:600 }}>{item.label}</span>
<span style={{ color:'#1E7EF7', fontWeight:700 }}>{item.pct}%</span>
</div>
<div className="prog-wrap"><div className="prog-fill" style={{ width:item.pct+'%' }} /></div>
</div>
))}
</div>
<div className="sec-hd"><h3>Trust Tiers</h3></div>
<div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:9, padding:'0 16px', marginBottom:14 }}>
{tiers.map(t => (
<div key={t.name} style={{ background:'#152236', borderRadius:13, padding:13, border:`1.5px solid ${t.name===myBiz.trust_tier?tierColor(t.name):'rgba(255,255,255,0.07)'}` }}>
<div style={{ fontSize:26, marginBottom:5 }}>{t.icon}</div>
<div style={{ fontFamily:'Syne, sans-serif', fontSize:13, fontWeight:700, color:t.name===myBiz.trust_tier?tierColor(t.name):'#fff' }}>{t.name}</div>
<div style={{ fontSize:10.5, color:'#7A92B0', margin:'2px 0 5px' }}>Score {t.range}</div>
{t.name===myBiz.trust_tier && <div style={{ display:'inline-block', background:'rgba(245,166,35,0.2)', color:'#F5A623', fontSize:9, fontWeight:800, padding:'2px 7px', borderRadius:5 }}>YOUR TIER</div>}
</div>
))}
</div>
<div className="sec-hd"><h3>Boost Your Score</h3></div>
<div style={{ margin:'0 16px', background:'#152236', borderRadius:13, border:'1px solid rgba(255,255,255,0.07)', overflow:'hidden' }}>
{boosts.map((b,i) => (
<div key={b.label} onClick={() => !b.done && b.action?.()} style={{ display:'flex', alignItems:'center', gap:11, padding:'11px 13px', borderBottom:i<boosts.length-1?'1px solid rgba(255,255,255,0.07)':'none', opacity:b.done?0.5:1, cursor:!b.done&&b.action?'pointer':'default' }}>
<div style={{ fontSize:17, flexShrink:0 }}>{b.icon}</div>
<div style={{ flex:1 }}>
<div style={{ fontSize:12.5, fontWeight:600, textDecoration:b.done?'line-through':'none', color:b.done?'#7A92B0':'#fff' }}>{b.label}</div>
{b.done && <div style={{ fontSize:10, color:'#00D4A0', fontWeight:700, marginTop:1 }}>✓ Complete</div>}
</div>
<div style={{ fontSize:12, fontWeight:800, color:b.done?'#7A92B0':'#00D4A0', flexShrink:0 }}>{b.done?'✓':'+'+b.pts+' pts'}</div>
</div>
))}
</div>
<div style={{ height:8 }} />
</div>
)
}

export function KycFormPage({ onBack }: { onBack?: ()=>void }) {
const { myBiz, toast } = useApp()
const [ownerName, setOwnerName] = useState('')
const [companyReg, setCompanyReg] = useState('')
const [country, setCountry] = useState(myBiz?.country || '')
const [idUrl, setIdUrl] = useState('')
const [uploading, setUploading] = useState(false)
const [saving, setSaving] = useState(false)
const [agreed, setAgreed] = useState(false)
const [err, setErr] = useState('')
const [submitted, setSubmitted] = useState(false)

if (!myBiz) return <div className="empty"><div className="ico">🛡️</div><h3>KYC Verification</h3><p>Create a business profile first.</p></div>

const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0]
  if (!file) return
  setErr('')
  if (file.size > 20 * 1024 * 1024) { setErr('File must be under 20MB'); e.target.value = ''; return }
  const allowed = file.type.startsWith('image/') || file.type === 'application/pdf'
  if (!allowed) { setErr('Upload an image or PDF document'); e.target.value = ''; return }
  setUploading(true)
  const url = await uploadImage(file, 'kyc-ids')
  setUploading(false)
  e.target.value = ''
  if (!url) { setErr(getLastUploadError() || 'Upload failed'); return }
  setIdUrl(url)
  toast('ID uploaded')
}

const submit = async () => {
  setErr('')
  if (!ownerName.trim() || !companyReg.trim() || !country.trim()) { setErr('Please fill all required fields'); return }
  if (!idUrl) { setErr('Please upload a government ID'); return }
  if (!agreed) { setErr('Please confirm declaration'); return }
  setSaving(true)
  const { data: submission, error: submissionErr } = await sb
    .from('kyc_submissions')
    .insert({
      business_id: myBiz.id,
      owner_name: ownerName.trim(),
      company_registration_no: companyReg.trim(),
      country: country.trim(),
      document_url: idUrl,
      status: 'pending'
    })
    .select()
    .single()
  if (submissionErr) {
    setSaving(false)
    setErr('Failed to submit KYC form: ' + submissionErr.message)
    return
  }
  setSubmitted(true)
  const { data: reviewData, error: reviewErr } = await sb.functions.invoke('review-kyc-submission', {
    body: { submissionId: submission.id }
  })
  setSaving(false)
  if (reviewErr) {
    toast('KYC submitted. Review is pending.', 'info')
    onBack?.()
    return
  }
  if (reviewData?.status === 'approved') {
    toast('KYC approved by AI reviewer ✅')
  } else if (reviewData?.status === 'rejected') {
    toast('KYC rejected. Please correct details and resubmit.', 'error')
  } else {
    toast('KYC submitted. Review is pending.', 'info')
  }
  onBack?.()
}

return (
<div style={{ paddingBottom:20 }}>
  <div className="topbar">
    <button onClick={onBack} style={{ background:'none', border:'none', color:'#7A92B0', fontSize:16, cursor:'pointer', padding:'4px 8px' }}>← Back</button>
    <div className="page-title">KYC Verification</div>
    <div style={{ width:60 }} />
  </div>
  <div style={{ padding:'0 16px' }}>
    <div style={{ marginBottom:12, fontSize:12, color:'#7A92B0', lineHeight:1.6 }}>
      Submit your KYC details for manual review. Approval unlocks your verified badge and trust score boost.
    </div>
    {submitted && <div style={{ marginBottom:10, color:'#00D4A0', fontSize:12, fontWeight:700 }}>KYC submitted successfully.</div>}
    <div className="field"><label>Owner/Representative Name *</label><input placeholder="Full legal name" value={ownerName} onChange={e => setOwnerName(e.target.value)} /></div>
    <div className="field"><label>Company Registration Number *</label><input placeholder="CR / trade license number" value={companyReg} onChange={e => setCompanyReg(e.target.value)} /></div>
    <div className="field"><label>Country of Registration *</label><input placeholder="Country" value={country} onChange={e => setCountry(e.target.value)} /></div>
    <div className="field">
      <label>Government ID / Registration Proof *</label>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <label style={{ padding:'8px 12px', borderRadius:9, background:'#152236', border:'1px solid rgba(255,255,255,0.07)', fontSize:12, color:'#7A92B0', cursor:'pointer', fontWeight:700 }}>
          {uploading ? 'Uploading...' : idUrl ? 'Change Document' : 'Upload Document'}
          <input type="file" accept="image/*,.pdf,application/pdf" onChange={handleUpload} style={{ display:'none' }} />
        </label>
        {idUrl && <span style={{ fontSize:11, color:'#00D4A0', fontWeight:700 }}>Uploaded</span>}
      </div>
    </div>
    <div style={{ background:'#152236', border:'1px solid rgba(255,255,255,0.07)', borderRadius:11, padding:'10px 11px', marginBottom:12, display:'flex', gap:8, alignItems:'flex-start' }}>
      <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} style={{ marginTop:2 }} />
      <div style={{ fontSize:11.5, color:'#7A92B0', lineHeight:1.5 }}>
        I confirm the submitted details are accurate and I am authorized to represent this business.
      </div>
    </div>
    {err && <div className="form-err">{err}</div>}
    <button className="btn btn-blue btn-full" onClick={submit} disabled={saving}>{saving ? 'Submitting...' : 'Submit KYC Form'}</button>
  </div>
</div>
)
}