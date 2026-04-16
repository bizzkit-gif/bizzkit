import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { sb, Chat, Msg, Business, grad, fmtTime, timeAgo, displayChatMessageText, chatCallInviteMessageRinging, markLatestChatCallInviteAsMissed, fetchBusinessProfilesByIds, fetchBusinessByIdRobust, otherChatParticipantId, normalizeUuid } from '../lib/db'
import { PeerVideoCall } from '../components/PeerVideoCall'
import { useBusinessOnlineMap } from '../lib/presence'
import { sendPushNotification } from '../lib/push'
import { vibrateIfEnabled } from '../lib/notificationSettings'
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

/** List row only — avoids N+1 `businesses` + `messages` round-trips per chat. */
const CHAT_PEER_SELECT = 'id,name,logo,logo_url,industry,city'

/** If batch `businesses.in()` misses a row (RLS, etc.), still render the thread. */
function fallbackPeer(othId: string): Business {
  return {
    id: othId,
    owner_id: '',
    name: 'Business',
    tagline: '',
    description: '',
    industry: '—',
    type: 'B2B',
    city: '',
    country: '',
    website: '',
    founded: '',
    logo: '',
    grad: 'gr1',
    kyc_verified: false,
    certified: false,
    trust_score: 0,
    trust_tier: 'Bronze',
    followers: 0,
    created_at: '',
    updated_at: '',
    _peer_placeholder: true,
  }
}

function isValidChatMsg(m: unknown): m is Msg {
  if (!m || typeof m !== 'object') return false
  const o = m as Record<string, unknown>
  return typeof o.id === 'string' && typeof o.sender_id === 'string'
}

function normalizeMsgs(rows: Msg[] | null | undefined): Msg[] {
  return (rows || []).filter(isValidChatMsg)
}

export default function MessagesPage({ openWith, onClearOpen }: { openWith?: string|null; onClearOpen?: () => void }) {
  const { myBiz, setUnread, toast, pendingChatCallFromBusinessId, clearPendingChatCall } = useApp()
  const [chats, setChats] = useState<Chat[]>([])
  const [activeId, setActiveId] = useState<string|null>(null)
  /** When user picks a thread while `openWith` RPC is still resolving, do not overwrite their choice. */
  const skipNextRpcAutoOpen = useRef(false)
  const openWithRef = useRef<string | null | undefined>(openWith)
  openWithRef.current = openWith
  const [loading, setLoading] = useState(true)
  const [incomingCallPeer, setIncomingCallPeer] = useState<Business | null>(null)
  const [videoCallOpen, setVideoCallOpen] = useState(false)
  const callAlertTimerRef = useRef<number | null>(null)
  /** Resolved peer id when opening a thread before `chats` has `other_biz` (single presence subscription — see ChatView). */
  const [activePeerId, setActivePeerId] = useState<string | null>(null)
  /** When ChatView loads `fetchedOther` before parent has that id in `chats` / `activePeerId`. */
  const [peerOverrideId, setPeerOverrideId] = useState<string | null>(null)

  useEffect(() => {
    if (!myBiz?.id) {
      setActivePeerId(null)
      return
    }
    if (!activeId) {
      setActivePeerId(null)
      return
    }
    const fromChat = chats.find((c) => c.id === activeId)?.other_biz?.id
    if (fromChat) {
      setActivePeerId(fromChat)
      return
    }
    setActivePeerId(null)
    let cancelled = false
    void sb
      .from('chats')
      .select('participant_a,participant_b')
      .eq('id', activeId)
      .single()
      .then(({ data: row }) => {
        if (cancelled || !row) return
        setActivePeerId(otherChatParticipantId(row as { participant_a: string; participant_b: string }, myBiz.id))
      })
    return () => {
      cancelled = true
    }
  }, [activeId, myBiz?.id, chats])

  useEffect(() => {
    if (!activeId) setPeerOverrideId(null)
  }, [activeId])

  const onDisplayOtherResolved = useCallback((id: string) => {
    setPeerOverrideId(id)
  }, [])

  const watchOnlineIds = useMemo(() => {
    const s = new Set<string>()
    for (const c of chats) {
      if (c.other_biz?.id) s.add(c.other_biz.id)
    }
    if (activePeerId) s.add(activePeerId)
    if (peerOverrideId) s.add(peerOverrideId)
    return Array.from(s)
  }, [chats, activePeerId, peerOverrideId])

  const onlineById = useBusinessOnlineMap(myBiz?.id, watchOnlineIds)

  const loadChats = useCallback(async () => {
    if (!myBiz) return
    try {
      const { data: rows, error: rowsErr } = await sb
        .from('chats')
        .select('id,participant_a,participant_b,created_at')
        .or(`participant_a.eq.${myBiz.id},participant_b.eq.${myBiz.id}`)
      if (rowsErr) {
        console.warn('loadChats chats:', rowsErr.message)
        setChats([])
        setUnread(0)
        return
      }
      if (!rows?.length) {
        setChats([])
        setUnread(0)
        return
      }

      const chatIds = rows.map((c) => c.id)
      const othIds = [...new Set(rows.map((c: { participant_a: string; participant_b: string }) => otherChatParticipantId(c, myBiz.id)))]

      const msgLimit = Math.min(5000, Math.max(400, chatIds.length * 100))

      const [peerRows, unreadRes, recentMsgsRes] = await Promise.all([
        fetchBusinessProfilesByIds(CHAT_PEER_SELECT, othIds),
        sb.from('messages').select('chat_id').in('chat_id', chatIds).neq('sender_id', myBiz.id).eq('read', false),
        sb
          .from('messages')
          .select('chat_id,sender_id,text,created_at')
          .in('chat_id', chatIds)
          .order('created_at', { ascending: false })
          .limit(msgLimit),
      ])

      const peerById = new Map(peerRows.map((p: Business) => [normalizeUuid(p.id), p]))
      const unreadByChat = new Map<string, number>()
      for (const r of unreadRes.data || []) {
        const cid = (r as { chat_id: string }).chat_id
        unreadByChat.set(cid, (unreadByChat.get(cid) || 0) + 1)
      }

      const lastByChat = new Map<string, { text: string; created_at: string }>()
      for (const m of recentMsgsRes.data || []) {
        const row = m as { chat_id: string; text: string | null; created_at: string }
        if (!lastByChat.has(row.chat_id)) {
          lastByChat.set(row.chat_id, { text: row.text ?? '', created_at: row.created_at })
        }
      }

      const enriched: Chat[] = rows.map((c: { id: string; participant_a: string; participant_b: string; created_at: string }) => {
        const othId = otherChatParticipantId(c, myBiz.id)
        const other = peerById.get(normalizeUuid(othId)) ?? fallbackPeer(othId)
        const last = lastByChat.get(c.id)
        return {
          ...c,
          other_biz: other,
          last_msg: last?.text,
          last_ts: last?.created_at,
          unread: unreadByChat.get(c.id) || 0,
        }
      })
      enriched.sort((a, b) =>
        String(b.last_ts || b.created_at || '').localeCompare(String(a.last_ts || a.created_at || ''))
      )
      setChats(enriched)
      setUnread(enriched.reduce((s, c) => s + (c.unread || 0), 0))
    } catch (e) {
      console.warn('loadChats', e)
      setChats([])
      setUnread(0)
    } finally {
      setLoading(false)
    }
  }, [myBiz, setUnread])

  useEffect(() => { loadChats() }, [loadChats])

  useEffect(() => {
    if (!openWith || !myBiz) return
    void sb.rpc('get_or_create_chat', { biz_a: myBiz.id, biz_b: openWith }).then(({ data }) => {
      if (skipNextRpcAutoOpen.current) {
        skipNextRpcAutoOpen.current = false
        onClearOpen?.()
        void loadChats()
        return
      }
      if (data) {
        setActiveId(data)
        void loadChats()
      }
      onClearOpen?.()
    }).catch(() => {
      onClearOpen?.()
    })
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
      const data = await fetchBusinessByIdRobust(sid)
      if (!cancelled && data) {
        setIncomingCallPeer(data)
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
      vibrateIfEnabled(120)
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
    const chat = chats.find((c) => c.id === activeId)
    const peerIdForPresence = chat?.other_biz?.id ?? activePeerId ?? peerOverrideId
    const isOtherOnline = !!(peerIdForPresence && onlineById[peerIdForPresence])
    return (
      <ChatView
        chatId={activeId}
        other={chat?.other_biz || null}
        myBiz={myBiz}
        myId={myBiz.id}
        isOtherOnline={isOtherOnline}
        onDisplayOtherResolved={onDisplayOtherResolved}
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
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0, width: '100%', overflow: 'hidden' }}>
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
        const peer = c.other_biz ?? fallbackPeer(otherChatParticipantId(c, myBiz.id))
        const isOnline = !!onlineById[peer.id]
        return (
          <div
            key={c.id}
            onClick={() => {
              if (openWithRef.current) skipNextRpcAutoOpen.current = true
              setActiveId(c.id)
            }}
            style={{ display:'flex', alignItems:'center', gap:11, padding:'12px 16px', borderBottom:'1px solid rgba(255,255,255,0.07)', cursor:'pointer' }}
          >
            <div className={grad(peer.id)} style={{ width:46, height:46, borderRadius:13, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Syne, sans-serif', fontWeight:800, fontSize:15, color:'#fff', flexShrink:0, position:'relative', overflow:'hidden' }}>
              {normalizeLogoImage(peer.logo)
                ? <img src={normalizeLogoImage(peer.logo) || ''} alt={peer.name} style={{ width:'100%', height:'100%', objectFit:'cover' as const }} />
                : logoInitials(peer.name)}
              {(c.unread||0) > 0 && <div className="bni-badge">{c.unread}</div>}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, minWidth:0 }}>
                  <div style={{ fontFamily:'Syne, sans-serif', fontSize:13.5, fontWeight:700, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{peer.name}</div>
                  {isOnline && <div style={{ width:8, height:8, borderRadius:'50%', background:'#00D46A', flexShrink:0 }} />}
                </div>
                {c.last_ts && <div style={{ fontSize:10, color:'#7A92B0', flexShrink:0, marginLeft:8 }}>{timeAgo(c.last_ts)}</div>}
              </div>
              <div style={{ fontSize:10.5, color:'#3A5070', marginTop:1 }}>{peer.industry} · {peer.city}</div>
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
  isOtherOnline,
  onDisplayOtherResolved,
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
  /** From parent’s single Realtime Presence subscription (avoid duplicate channel subscribe). */
  isOtherOnline: boolean
  /** Lets parent add peer id to presence watch list when `other` was loaded here. */
  onDisplayOtherResolved?: (businessId: string) => void
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
    const needPeer = !other || other._peer_placeholder === true
    if (!needPeer || !chatId || !myBiz) return
    let cancelled = false
    void (async () => {
      const { data: row } = await sb.from('chats').select('participant_a,participant_b').eq('id', chatId).single()
      if (cancelled || !row) return
      const oid = otherChatParticipantId(row as { participant_a: string; participant_b: string }, myBiz.id)
      const b = await fetchBusinessByIdRobust(oid)
      if (!cancelled && b) setFetchedOther(b)
    })()
    return () => {
      cancelled = true
    }
  }, [chatId, myBiz.id, other?.id, other?._peer_placeholder])

  const displayOther =
    other && !other._peer_placeholder ? other : (fetchedOther ?? other)

  useEffect(() => {
    const id = displayOther?.id
    if (id) onDisplayOtherResolved?.(id)
  }, [displayOther?.id, onDisplayOtherResolved])

  const load = useCallback(async () => {
    const { data } = await sb.from('messages').select('*').eq('chat_id', chatId).order('created_at', { ascending:true })
    setMsgs(normalizeMsgs(data as Msg[] | null))
    await sb.from('messages').update({ read:true }).eq('chat_id', chatId).neq('sender_id', myId).eq('read', false)
  }, [chatId, myId])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    try {
      bottom.current?.scrollIntoView({ behavior:'smooth' })
    } catch {
      /* Safari can throw if layout not ready */
    }
  }, [msgs])

  useEffect(() => {
    const ch = sb.channel('chat-' + chatId)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'messages', filter:'chat_id=eq.'+chatId },
        (payload) => {
          const row = payload.new as Record<string, unknown> | null | undefined
          if (!row || typeof row !== 'object' || typeof row.id !== 'string') return
          const next = row as unknown as Msg
          setMsgs((p) => {
            if (p.some((m) => m.id === next.id)) return p
            return [...p, next]
          })
          if (next.sender_id !== myId && typeof row.id === 'string') {
            void sb.from('messages').update({ read:true }).eq('id', row.id)
          }
        })
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'messages', filter:'chat_id=eq.'+chatId },
        (payload) => {
          const row = payload.new as Record<string, unknown> | null | undefined
          if (!row || typeof row !== 'object' || typeof row.id !== 'string') return
          const next = row as unknown as Msg
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
  normalizeMsgs(msgs).forEach((m) => {
    const d = new Date(m.created_at || 0).toDateString()
    const last = grouped[grouped.length - 1]
    if (last && last.date === d) last.msgs.push(m)
    else grouped.push({ date: d, msgs: [m] })
  })

  if (videoCallOpen && displayOther) {
    const signalingChannelId = `msgvc-${chatId.replace(/-/g, '')}`
    return (
      <div className="call-wrap" style={{ background: '#0A1628', flex: 1, minHeight: 0, minWidth: 0, width: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
    <div style={{ display:'flex', flexDirection:'column', flex:1, minHeight:0, minWidth:0, width:'100%', overflow:'hidden' }}>
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
        </div>}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, minWidth:0 }}>
            <div style={{ fontFamily:'Syne, sans-serif', fontSize:14, fontWeight:700, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{displayOther?.name||'Chat'}</div>
            {isOtherOnline && <div style={{ width:8, height:8, borderRadius:'50%', background:'#00D46A', flexShrink:0 }} />}
          </div>
          <div style={{ fontSize:10.5, color:'#7A92B0' }}>{displayOther?.industry} · {displayOther?.city}</div>
        </div>
        <div className="icon-btn" style={{ width:34, height:34, fontSize:14 }} onClick={startCall}>📞</div>
      </div>

      <div style={{ flex:1, minHeight:0, overflowY:'auto', WebkitOverflowScrolling:'touch', padding:'11px 15px' }}>
        {msgs.length === 0 && <div style={{ textAlign:'center', padding:'30px 0', color:'#7A92B0' }}><div style={{ fontSize:26, marginBottom:8 }}>👋</div><div style={{ fontSize:12.5 }}>Start the conversation</div></div>}
        {grouped.map(g => (
          <div key={g.date}>
            <div style={{ textAlign:'center', margin:'10px 0 9px' }}>
              <span style={{ fontSize:9.5, color:'#3A5070', background:'#152236', padding:'3px 9px', borderRadius:9, fontWeight:600 }}>{new Date(g.msgs[0]?.created_at || 0).toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' })}</span>
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
                    <div style={{ fontSize:9.5, color:'#3A5070', marginTop:2, textAlign:mine?'right':'left' }}>{fmtTime(m.created_at || '')}</div>
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
