import React, { useState, useEffect, useRef, useCallback } from 'react'
import { sb, Chat, Msg, Business, grad, fmtTime, timeAgo, displayChatMessageText, chatCallInviteMessageRinging, markLatestChatCallInviteAsMissed } from '../lib/db'
import { PeerVideoCall } from '../components/PeerVideoCall'
import { useBusinessOnlineMap } from '../lib/presence'
import { sendPushNotification } from '../lib/push'
import { useApp } from '../context/ctx'

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

export default function MessagesPage({ openWith, onClearOpen }: { openWith?: string|null; onClearOpen?: () => void }) {
  const { myBiz, setUnread, toast, pendingChatCallFromBusinessId, clearPendingChatCall } = useApp()
  const [chats, setChats] = useState<Chat[]>([])
  const [activeId, setActiveId] = useState<string|null>(null)
  const [loading, setLoading] = useState(true)
  const [incomingCallPeer, setIncomingCallPeer] = useState<Business | null>(null)
  const [videoCallOpen, setVideoCallOpen] = useState(false)
  const callAlertTimerRef = useRef<number | null>(null)
  const watchOnlineIds = chats.map((c) => c.other_biz?.id || '').filter(Boolean)
  const onlineById = useBusinessOnlineMap(myBiz?.id, watchOnlineIds)

  const loadChats = useCallback(async () => {
    if (!myBiz) return
    const { data } = await sb.from('chats').select('*').or(`participant_a.eq.${myBiz.id},participant_b.eq.${myBiz.id}`)
    if (!data) { setLoading(false); return }
    const enriched: Chat[] = await Promise.all(data.map(async (c: any) => {
      const othId = c.participant_a === myBiz.id ? c.participant_b : c.participant_a
      const { data: other } = await sb.from('businesses').select('*').eq('id', othId).single()
      const { data: msgs } = await sb.from('messages').select('*').eq('chat_id', c.id).order('created_at', { ascending: false }).limit(1)
      const { count } = await sb.from('messages').select('*', { count:'exact', head:true }).eq('chat_id', c.id).neq('sender_id', myBiz.id).eq('read', false)
      return { ...c, other_biz: other, last_msg: msgs?.[0]?.text, last_ts: msgs?.[0]?.created_at, unread: count||0 }
    }))
    enriched.sort((a, b) => (b.last_ts||b.created_at).localeCompare(a.last_ts||a.created_at))
    setChats(enriched)
    setUnread(enriched.reduce((s, c) => s + (c.unread||0), 0))
    setLoading(false)
  }, [myBiz?.id])

  useEffect(() => { loadChats() }, [loadChats])

  useEffect(() => {
    if (openWith && myBiz) {
      sb.rpc('get_or_create_chat', { biz_a: myBiz.id, biz_b: openWith }).then(({ data }) => {
        if (data) { setActiveId(data); loadChats() }
        onClearOpen?.()
      })
    }
  }, [openWith, myBiz?.id])

  useEffect(() => {
    if (!myBiz || !pendingChatCallFromBusinessId) return
    let cancelled = false
    const sid = pendingChatCallFromBusinessId
    void (async () => {
      const known = chats.find((c) => c.other_biz?.id === sid)?.other_biz ?? null
      if (known) {
        if (!cancelled) {
          setIncomingCallPeer(known)
          clearPendingChatCall()
        }
        return
      }
      const { data } = await sb.from('businesses').select('*').eq('id', sid).single()
      if (!cancelled && data) {
        setIncomingCallPeer(data as Business)
        clearPendingChatCall()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [myBiz?.id, pendingChatCallFromBusinessId, chats, clearPendingChatCall])

  useEffect(() => {
    if (!incomingCallPeer) {
      if (callAlertTimerRef.current) {
        window.clearInterval(callAlertTimerRef.current)
        callAlertTimerRef.current = null
      }
      return
    }
    if (callAlertTimerRef.current) window.clearInterval(callAlertTimerRef.current)
    callAlertTimerRef.current = window.setInterval(() => {
      if (navigator.vibrate) navigator.vibrate(120)
    }, 1800)
    return () => {
      if (callAlertTimerRef.current) {
        window.clearInterval(callAlertTimerRef.current)
        callAlertTimerRef.current = null
      }
    }
  }, [incomingCallPeer])

  if (!myBiz) return <div className="empty"><div className="ico">💬</div><h3>Your Messages</h3><p>Create a business profile to start messaging.</p></div>

  if (activeId) {
    const chat = chats.find(c => c.id === activeId)
    return (
      <ChatView
        chatId={activeId}
        other={chat?.other_biz || null}
        myBiz={myBiz}
        myId={myBiz.id}
        onBack={() => {
          setActiveId(null)
          setVideoCallOpen(false)
          loadChats()
        }}
        toast={toast}
        incomingCallPeer={incomingCallPeer}
        onClearIncomingCall={() => setIncomingCallPeer(null)}
        videoCallOpen={videoCallOpen}
        setVideoCallOpen={setVideoCallOpen}
      />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {incomingCallPeer && (
        <div style={{ margin: '0 12px 8px', flexShrink: 0, background: 'rgba(30,126,247,0.15)', border: '1px solid rgba(30,126,247,0.45)', borderRadius: 12, padding: '10px 11px' }}>
          <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 12.5, fontWeight: 700, marginBottom: 3 }}>📞 Incoming Call</div>
          <div style={{ fontSize: 11, color: '#7A92B0', marginBottom: 8 }}>{incomingCallPeer.name} is calling you in Chat.</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-green btn-sm"
              style={{ flex: 1 }}
              onClick={() => {
                void (async () => {
                  const { data: chatId } = await sb.rpc('get_or_create_chat', { biz_a: myBiz.id, biz_b: incomingCallPeer.id })
                  if (chatId) {
                    setActiveId(chatId)
                    setVideoCallOpen(true)
                    setIncomingCallPeer(null)
                    if (callAlertTimerRef.current) {
                      window.clearInterval(callAlertTimerRef.current)
                      callAlertTimerRef.current = null
                    }
                    loadChats()
                  }
                })()
              }}
            >
              Accept
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ flex: 1 }}
              onClick={() => {
                void (async () => {
                  const r = await markLatestChatCallInviteAsMissed(myBiz.id, incomingCallPeer.id)
                  if (!r.ok) {
                    toast(r.error, 'error')
                    return
                  }
                  toast('Call marked as missed', 'info')
                  setIncomingCallPeer(null)
                  if (callAlertTimerRef.current) {
                    window.clearInterval(callAlertTimerRef.current)
                    callAlertTimerRef.current = null
                  }
                  loadChats()
                })()
              }}
            >
              Decline
            </button>
          </div>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 16 }}>
      <div className="topbar">
        <div className="page-title">Messages</div>
        <div style={{ fontSize:12, color:'#7A92B0' }}>{chats.length} conversation{chats.length!==1?'s':''}</div>
      </div>
      {loading && <div style={{ display:'flex', justifyContent:'center', padding:'40px 0' }}><div className="spinner" /></div>}
      {!loading && chats.length === 0 && <div className="empty"><div className="ico">💬</div><h3>No messages yet</h3><p>Connect with businesses in the Feed to start conversations.</p></div>}
      {chats.map(c => {
        if (!c.other_biz) return null
        const isOnline = !!onlineById[c.other_biz.id]
        return (
          <div key={c.id} onClick={() => setActiveId(c.id)} style={{ display:'flex', alignItems:'center', gap:11, padding:'12px 16px', borderBottom:'1px solid rgba(255,255,255,0.07)', cursor:'pointer' }}>
            <div className={grad(c.other_biz.id)} style={{ width:46, height:46, borderRadius:13, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Syne, sans-serif', fontWeight:800, fontSize:15, color:'#fff', flexShrink:0, position:'relative', overflow:'hidden' }}>
              {normalizeLogoImage(c.other_biz.logo)
                ? <img src={normalizeLogoImage(c.other_biz.logo) || ''} alt={c.other_biz.name} style={{ width:'100%', height:'100%', objectFit:'cover' as const }} />
                : logoInitials(c.other_biz.name)}
              {(c.unread||0) > 0 && <div className="bni-badge">{c.unread}</div>}
              {isOnline && (
                <div style={{ position:'absolute', right:2, bottom:2, width:10, height:10, borderRadius:'50%', background:'#00D46A', border:'2px solid #0A1628' }} />
              )}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
                <div style={{ fontFamily:'Syne, sans-serif', fontSize:13.5, fontWeight:700 }}>{c.other_biz.name}</div>
                {c.last_ts && <div style={{ fontSize:10, color:'#7A92B0', flexShrink:0, marginLeft:8 }}>{timeAgo(c.last_ts)}</div>}
              </div>
              <div style={{ fontSize:10.5, color:'#3A5070', marginTop:1 }}>{c.other_biz.industry} · {c.other_biz.city}</div>
              {c.last_msg && <div style={{ fontSize:12, color:(c.unread||0)>0?'#fff':'#3A5070', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontWeight:(c.unread||0)>0?600:400 }}>{displayChatMessageText(c.last_msg)}</div>}
            </div>
            <div style={{ color:'#3A5070', fontSize:16 }}>›</div>
          </div>
        )
      })}
      </div>
    </div>
  )
}

function ChatView({
  chatId,
  other,
  myBiz,
  myId,
  onBack,
  toast,
  incomingCallPeer,
  onClearIncomingCall,
  videoCallOpen,
  setVideoCallOpen,
}: {
  chatId: string
  other: Business | null
  myBiz: Business
  myId: string
  onBack: () => void
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void
  incomingCallPeer: Business | null
  onClearIncomingCall: () => void
  videoCallOpen: boolean
  setVideoCallOpen: (v: boolean) => void
}) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [fetchedOther, setFetchedOther] = useState<Business | null>(null)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setFetchedOther(null)
  }, [chatId])

  useEffect(() => {
    if (other || !chatId || !myBiz) return
    let cancelled = false
    void (async () => {
      const { data: row } = await sb.from('chats').select('participant_a,participant_b').eq('id', chatId).single()
      if (cancelled || !row) return
      const ra = row.participant_a as string
      const rb = row.participant_b as string
      const oid = ra === myBiz.id ? rb : ra
      const { data: b } = await sb.from('businesses').select('*').eq('id', oid).single()
      if (!cancelled && b) setFetchedOther(b as Business)
    })()
    return () => {
      cancelled = true
    }
  }, [chatId, myBiz.id, other?.id])

  const displayOther = other ?? fetchedOther
  const onlineById = useBusinessOnlineMap(myBiz.id, displayOther?.id ? [displayOther.id] : [])
  const isOtherOnline = !!(displayOther?.id && onlineById[displayOther.id])

  const load = useCallback(async () => {
    const { data } = await sb.from('messages').select('*').eq('chat_id', chatId).order('created_at', { ascending:true })
    setMsgs(data||[])
    await sb.from('messages').update({ read:true }).eq('chat_id', chatId).neq('sender_id', myId).eq('read', false)
  }, [chatId, myId])

  useEffect(() => { load() }, [load])
  useEffect(() => { bottom.current?.scrollIntoView({ behavior:'smooth' }) }, [msgs])

  useEffect(() => {
    const ch = sb.channel('chat-' + chatId)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'messages', filter:'chat_id=eq.'+chatId },
        payload => {
          setMsgs(p => [...p, payload.new as Msg])
          if ((payload.new as Msg).sender_id !== myId) sb.from('messages').update({ read:true }).eq('id', payload.new.id)
        })
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'messages', filter:'chat_id=eq.'+chatId },
        payload => {
          const next = payload.new as Msg
          setMsgs((p) => {
            const i = p.findIndex((m) => m.id === next.id)
            if (i === -1) return p
            const copy = [...p]
            copy[i] = next
            return copy
          })
        })
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [chatId, myId])

  const send = async () => {
    const text = input.trim()
    if (!text || sending) return
    setSending(true); setInput('')
    await sb.from('messages').insert({ chat_id:chatId, sender_id:myId, text })
    if (displayOther?.id) {
      await sendPushNotification({
        recipientBusinessId: displayOther.id,
        senderBusinessId: myId,
        title: myBiz.name,
        body: text.length > 120 ? `${text.slice(0, 117)}...` : text,
        tag: `chat-msg-${chatId}`,
        url: '/?tab=messages',
      })
    }
    setSending(false)
  }

  const startCall = async () => {
    if (!displayOther) {
      toast('Could not start call', 'error')
      return
    }
    const { error } = await sb.from('messages').insert({
      chat_id: chatId,
      sender_id: myId,
      text: chatCallInviteMessageRinging(myBiz.name),
    })
    if (error) {
      toast('Could not ring the other party: ' + error.message, 'error')
      return
    }
    await sendPushNotification({
      recipientBusinessId: displayOther.id,
      senderBusinessId: myId,
      title: `${myBiz.name} is calling`,
      body: 'Incoming video call in Chat.',
      tag: `chat-call-${chatId}`,
      url: '/?tab=messages',
    })
    setVideoCallOpen(true)
  }

  const showIncomingBanner =
    !!incomingCallPeer && !videoCallOpen && !!displayOther && displayOther.id === incomingCallPeer.id

  const QUICK = ["👋 Hello!", "Let's connect", "Request a quote?", "Schedule a call?"]

  const grouped: { date:string; msgs:Msg[] }[] = []
  msgs.forEach(m => {
    const d = new Date(m.created_at).toDateString()
    const last = grouped[grouped.length-1]
    if (last && last.date === d) last.msgs.push(m)
    else grouped.push({ date:d, msgs:[m] })
  })

  if (videoCallOpen && displayOther) {
    const signalingChannelId = `msgvc-${chatId.replace(/-/g, '')}`
    return (
      <div className="call-wrap" style={{ background: '#0A1628' }}>
        <PeerVideoCall
          myBiz={myBiz}
          other={displayOther}
          signalingChannelId={signalingChannelId}
          onEnd={() => setVideoCallOpen(false)}
          onEndWithoutRemote={async () => {
            const r = await markLatestChatCallInviteAsMissed(myId, displayOther.id)
            if (!r.ok) toast(r.error, 'error')
          }}
          headerEmoji="📞"
          connectingHint={`Connecting… waiting for ${displayOther.name} to join.`}
        />
      </div>
    )
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', minHeight:0 }}>
      {showIncomingBanner && (
        <div style={{ margin: '0 12px 8px', flexShrink: 0, background: 'rgba(30,126,247,0.15)', border: '1px solid rgba(30,126,247,0.45)', borderRadius: 12, padding: '10px 11px' }}>
          <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 12.5, fontWeight: 700, marginBottom: 3 }}>📞 Incoming Call</div>
          <div style={{ fontSize: 11, color: '#7A92B0', marginBottom: 8 }}>{incomingCallPeer.name} is calling you in Chat.</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-green btn-sm"
              style={{ flex: 1 }}
              onClick={() => {
                setVideoCallOpen(true)
                onClearIncomingCall()
              }}
            >
              Accept
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ flex: 1 }}
              onClick={() => {
                void (async () => {
                  const r = await markLatestChatCallInviteAsMissed(myBiz.id, incomingCallPeer.id)
                  if (!r.ok) {
                    toast(r.error, 'error')
                    return
                  }
                  toast('Call marked as missed', 'info')
                  onClearIncomingCall()
                  await load()
                })()
              }}
            >
              Decline
            </button>
          </div>
        </div>
      )}
      <div style={{ display:'flex', alignItems:'center', gap:11, padding:'11px 15px 9px', borderBottom:'1px solid rgba(255,255,255,0.07)', flexShrink:0 }}>
        <button onClick={onBack} style={{ background:'none', border:'none', color:'#7A92B0', fontSize:20, cursor:'pointer', padding:'2px 5px', flexShrink:0 }}>←</button>
        {displayOther && <div className={grad(displayOther.id)} style={{ width:38, height:38, borderRadius:11, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Syne, sans-serif', fontWeight:800, fontSize:14, color:'#fff', flexShrink:0, overflow:'hidden', position:'relative' }}>
          {normalizeLogoImage(displayOther.logo)
            ? <img src={normalizeLogoImage(displayOther.logo) || ''} alt={displayOther.name} style={{ width:'100%', height:'100%', objectFit:'cover' as const }} />
            : logoInitials(displayOther.name)}
          {isOtherOnline && <div style={{ position:'absolute', right:1, bottom:1, width:9, height:9, borderRadius:'50%', background:'#00D46A', border:'2px solid #0A1628' }} />}
        </div>}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:'Syne, sans-serif', fontSize:14, fontWeight:700, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{displayOther?.name||'Chat'}</div>
          <div style={{ fontSize:10.5, color:'#7A92B0' }}>{displayOther?.industry} · {displayOther?.city}</div>
        </div>
        <div className="icon-btn" style={{ width:34, height:34, fontSize:14 }} onClick={startCall}>📞</div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'11px 15px' }}>
        {msgs.length === 0 && <div style={{ textAlign:'center', padding:'30px 0', color:'#7A92B0' }}><div style={{ fontSize:26, marginBottom:8 }}>👋</div><div style={{ fontSize:12.5 }}>Start the conversation</div></div>}
        {grouped.map(g => (
          <div key={g.date}>
            <div style={{ textAlign:'center', margin:'10px 0 9px' }}>
              <span style={{ fontSize:9.5, color:'#3A5070', background:'#152236', padding:'3px 9px', borderRadius:9, fontWeight:600 }}>{new Date(g.msgs[0].created_at).toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' })}</span>
            </div>
            {g.msgs.map((m, i) => {
              const mine = m.sender_id === myId
              return (
                <div key={m.id} style={{ display:'flex', flexDirection:mine?'row-reverse':'row', alignItems:'flex-end', gap:5, marginBottom:4 }}>
                  {!mine && displayOther && i === 0 && <div className={grad(displayOther.id)} style={{ width:26, height:26, borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:800, color:'#fff', flexShrink:0, overflow:'hidden' }}>
                    {normalizeLogoImage(displayOther.logo)
                      ? <img src={normalizeLogoImage(displayOther.logo) || ''} alt={displayOther.name} style={{ width:'100%', height:'100%', objectFit:'cover' as const }} />
                      : logoInitials(displayOther.name)}
                  </div>}
                  {!mine && i > 0 && <div style={{ width:26, flexShrink:0 }} />}
                  <div style={{ maxWidth:'72%' }}>
                    <div style={{ padding:'8px 11px', borderRadius:mine?'14px 14px 4px 14px':'14px 14px 14px 4px', background:mine?'#1E7EF7':'#1A2D47', color:'#fff', fontSize:13, lineHeight:1.5, border:mine?'none':'1px solid rgba(255,255,255,0.07)' }}>{displayChatMessageText(m.text)}</div>
                    <div style={{ fontSize:9.5, color:'#3A5070', marginTop:2, textAlign:mine?'right':'left' }}>{fmtTime(m.created_at)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <div style={{ padding:'7px 11px 10px', borderTop:'1px solid rgba(255,255,255,0.07)', flexShrink:0, background:'#0A1628' }}>
        <div style={{ display:'flex', gap:5, marginBottom:7, overflowX:'auto' }}>
          {QUICK.map(q => <div key={q} onClick={() => setInput(q)} style={{ padding:'5px 9px', borderRadius:9, background:'#152236', border:'1px solid rgba(255,255,255,0.07)', fontSize:10.5, fontWeight:600, color:'#7A92B0', cursor:'pointer', flexShrink:0, whiteSpace:'nowrap' }}>{q}</div>)}
        </div>
        <div style={{ display:'flex', gap:7, alignItems:'center' }}>
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key==='Enter' && send()} placeholder="Type a message…" style={{ flex:1, background:'#152236', border:'1px solid rgba(255,255,255,0.07)', borderRadius:13, padding:'9px 13px', color:'#fff', fontSize:13, outline:'none' }} />
          <button onClick={send} disabled={!input.trim()||sending} style={{ width:40, height:40, borderRadius:12, background:input.trim()?'#1E7EF7':'#152236', border:'none', color:'#fff', fontSize:18, cursor:input.trim()?'pointer':'default', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>↑</button>
        </div>
      </div>
    </div>
  )
}
