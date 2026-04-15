import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { sb, Business, RANDOM_CALL_INVITE_MARKER, CHAT_CALL_INVITE_MARKER } from '../lib/db'
import { setEmailHasProfile, clearEmailHasProfile } from '../lib/profileLocal'
import { playNotificationTone, syncAppIconBadge, tryShowNativeNotification } from '../lib/notify'
import { ensurePushSubscription } from '../lib/push'

type ToastType = 'success' | 'error' | 'info'

type Ctx = {
  user: any
  myBiz: Business | null
  loading: boolean
  tab: string
  setTab: (t: string) => void
  prevTab: string
  setPrevTab: (t: string) => void
  viewId: string | null
  setViewId: (id: string | null) => void
  chatWith: string | null
  setChatWith: (id: string | null) => void
  unread: number
  setUnread: (n: number) => void
  refreshBiz: () => Promise<Business | null>
  toast: (msg: string, type?: ToastType, durationMs?: number) => void
  toastMsg: string
  toastType: string
  toastVisible: boolean
  pendingRandomCallFromBusinessId: string | null
  clearPendingRandomCall: () => void
  pendingChatCallFromBusinessId: string | null
  clearPendingChatCall: () => void
  signOut: () => Promise<void>
}

const AppCtx = createContext<Ctx>({} as Ctx)
export const useApp = () => useContext(AppCtx)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null)
  const [myBiz, setMyBiz] = useState<Business | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('feed')
  const [prevTab, setPrevTab] = useState('feed')
  const [viewId, setViewId] = useState<string | null>(null)
  const [chatWith, setChatWith] = useState<string | null>(null)
  const [unread, setUnread] = useState(0)
  const [toastMsg, setToastMsg] = useState('')
  const [toastType, setToastType] = useState('success')
  const [toastVisible, setToastVisible] = useState(false)
  const [pendingRandomCallFromBusinessId, setPendingRandomCallFromBusinessId] = useState<string | null>(null)
  const [pendingChatCallFromBusinessId, setPendingChatCallFromBusinessId] = useState<string | null>(null)
  const unreadRef = useRef(0)
  const toastHideRef = useRef<number | null>(null)
  const lastRandomInviteMsgIdRef = useRef<string | null>(null)
  const lastChatInviteMsgIdRef = useRef<string | null>(null)

  const clearPendingRandomCall = useCallback(() => {
    setPendingRandomCallFromBusinessId(null)
  }, [])

  const clearPendingChatCall = useCallback(() => {
    setPendingChatCallFromBusinessId(null)
  }, [])

  const toast = useCallback((msg: string, type: ToastType = 'success', durationMs = 2800) => {
    if (toastHideRef.current) {
      window.clearTimeout(toastHideRef.current)
      toastHideRef.current = null
    }
    setToastMsg(msg)
    setToastType(type)
    setToastVisible(true)
    toastHideRef.current = window.setTimeout(() => {
      setToastVisible(false)
      toastHideRef.current = null
    }, durationMs)
  }, [])

  const signOut = useCallback(async () => {
    const { error } = await sb.auth.signOut()
    if (error) {
      toast(error.message, 'error')
      return
    }
    setTab('feed')
    setPrevTab('feed')
    setViewId(null)
    setChatWith(null)
    setUnread(0)
    setPendingRandomCallFromBusinessId(null)
    setPendingChatCallFromBusinessId(null)
    lastRandomInviteMsgIdRef.current = null
    lastChatInviteMsgIdRef.current = null
  }, [toast])

  type RandomInviteRow = { id?: string; sender_id?: string; text?: string | null }

  const handleChatInviteRow = useCallback((row: RandomInviteRow) => {
    if (!myBiz?.id) return
    if (!row?.sender_id || row.sender_id === myBiz.id) return
    const text = row.text || ''
    if (!text.includes(CHAT_CALL_INVITE_MARKER)) return
    if (!text.includes('is calling you')) return
    if (row.id && lastChatInviteMsgIdRef.current === row.id) return
    if (row.id) lastChatInviteMsgIdRef.current = row.id
    setPendingChatCallFromBusinessId(row.sender_id)
    setChatWith(row.sender_id)
    playNotificationTone('call')
    if (navigator.vibrate) navigator.vibrate([220, 120, 220, 120, 220, 120, 220])
    void tryShowNativeNotification('Incoming Chat Call', 'Open Chat to answer the call.', 'chat-call')
    toast('📞 Incoming Chat call — opening Chat to answer', 'info', 5200)
    setTab('messages')
  }, [myBiz?.id, toast, setTab, setChatWith])

  const handleRandomInviteRow = useCallback((row: RandomInviteRow) => {
    if (!myBiz?.id) return
    if (!row?.sender_id || row.sender_id === myBiz.id) return
    const text = row.text || ''
    if (!text.includes(RANDOM_CALL_INVITE_MARKER)) return
    // Only active ring invites — not rewritten "Missed call from …" rows.
    if (!text.includes('is calling you')) return
    if (row.id && lastRandomInviteMsgIdRef.current === row.id) return
    if (row.id) lastRandomInviteMsgIdRef.current = row.id
    setPendingRandomCallFromBusinessId(row.sender_id)
    playNotificationTone('call')
    if (navigator.vibrate) navigator.vibrate([220, 120, 220, 120, 220, 120, 220])
    void tryShowNativeNotification('Incoming Random Call', 'Open Random to answer the call.', 'random-call')
    toast('📞 Incoming Random call — tap Random to answer', 'info', 5200)
    setTab('random')
  }, [myBiz?.id, toast, setTab])

  const refreshBiz = useCallback(async (): Promise<Business | null> => {
    if (!user) return null
    const em = user.email ? String(user.email).toLowerCase().trim() : ''
    try {
      const { data } = await sb.from('businesses').select('*,products(*)').eq('owner_id', user.id).single()
      const nextBiz = data || null
      setMyBiz(nextBiz)
      if (em) {
        if (nextBiz?.id) setEmailHasProfile(em)
        else clearEmailHasProfile(em)
      }
      return nextBiz
    } catch {
      setMyBiz(null)
      return null
    }
  }, [user])

  useEffect(() => {
    const timeout = setTimeout(() => setLoading(false), 3000)

    sb.auth.getSession().then(({ data: { session } }) => {
      clearTimeout(timeout)
      setUser(session?.user || null)
      setLoading(false)
    }).catch(() => {
      clearTimeout(timeout)
      setLoading(false)
    })

    const { data: { subscription } } = sb.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user || null)
      if (!session) setMyBiz(null)
    })
    return () => { subscription.unsubscribe(); clearTimeout(timeout) }
  }, [])

  useEffect(() => {
    if (user) refreshBiz()
  }, [user])

  useEffect(() => {
    if (!myBiz?.id) { setUnread(0); return }

    let active = true
    const refreshUnread = async () => {
      const { data: chats } = await sb.from('chats').select('id').or(`participant_a.eq.${myBiz.id},participant_b.eq.${myBiz.id}`)
      const chatIds = (chats || []).map((c: { id: string }) => c.id)
      if (!chatIds.length) { if (active) setUnread(0); return }
      const { count } = await sb.from('messages').select('id', { count:'exact', head:true }).in('chat_id', chatIds).neq('sender_id', myBiz.id).eq('read', false)
      if (active) {
        const next = count || 0
        unreadRef.current = next
        setUnread(next)
      }
    }

    const onMessageInsert = async (payload: { new: Record<string, unknown> }) => {
      const row = payload.new as { id?: string; chat_id?: string; sender_id?: string; text?: string | null }
      if (!row?.chat_id || !row?.sender_id || row.sender_id === myBiz.id) return
      const { data: chat } = await sb.from('chats').select('participant_a,participant_b').eq('id', row.chat_id).single()
      if (!chat) return
      const isMine = chat.participant_a === myBiz.id || chat.participant_b === myBiz.id
      if (!isMine) return

      if (row.text?.includes(CHAT_CALL_INVITE_MARKER) && row.text.includes('is calling you')) {
        handleChatInviteRow(row)
        await refreshUnread()
        return
      }

      if (row.text?.includes(RANDOM_CALL_INVITE_MARKER)) {
        handleRandomInviteRow(row)
        await refreshUnread()
        return
      }

      await refreshUnread()
      // Sound for every incoming DM (not only when unread count increases — avoids missing a ping while in-thread).
      playNotificationTone('message')
      void tryShowNativeNotification('New message', 'You received a new chat message.', 'chat-message')
      if (navigator.vibrate) navigator.vibrate([120, 60, 120])
      if (tab !== 'messages') toast('New message received 💬', 'info')
    }

    /** Missed calls rewrite the same row (UPDATE). INSERT handlers never run for that. */
    const onMessageUpdate = async (payload: { new: Record<string, unknown>; old?: Record<string, unknown> }) => {
      const row = payload.new as { id?: string; chat_id?: string; sender_id?: string; text?: string | null }
      const oldRow = payload.old as { text?: string | null } | undefined
      if (!row?.chat_id || !row.text) {
        await refreshUnread()
        return
      }
      const { data: chat } = await sb.from('chats').select('participant_a,participant_b').eq('id', row.chat_id).single()
      if (!chat) return
      const isParticipant = chat.participant_a === myBiz.id || chat.participant_b === myBiz.id
      if (!isParticipant) return

      const becameMissed =
        row.text.includes(CHAT_CALL_INVITE_MARKER) &&
        row.text.includes('Missed call') &&
        !!oldRow?.text?.includes('is calling you')

      if (becameMissed && tab !== 'messages') {
        playNotificationTone('alert')
        void tryShowNativeNotification('Missed call', 'A call was missed or ended.', 'missed-call')
        toast('Chat call missed or ended', 'info', 3600)
        if (navigator.vibrate) navigator.vibrate([100, 80, 100])
      }
      await refreshUnread()
    }

    refreshUnread()
    const ch = sb.channel('global-unread-' + myBiz.id)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'messages' }, onMessageInsert)
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'messages' }, onMessageUpdate)
      .subscribe()

    return () => {
      active = false
      sb.removeChannel(ch)
    }
  }, [myBiz?.id, tab, toast, handleRandomInviteRow, handleChatInviteRow])

  useEffect(() => {
    const total = unread + (pendingRandomCallFromBusinessId ? 1 : 0) + (pendingChatCallFromBusinessId ? 1 : 0)
    syncAppIconBadge(total)
  }, [unread, pendingRandomCallFromBusinessId, pendingChatCallFromBusinessId])

  // Poll for Chat + Random call invites when Realtime is delayed or the app was in background (mobile Safari).
  useEffect(() => {
    if (!myBiz?.id) return

    const pollRecentInvites = async () => {
      const sinceIso = new Date(Date.now() - 120_000).toISOString()
      const { data: chats } = await sb.from('chats').select('id').or(`participant_a.eq.${myBiz.id},participant_b.eq.${myBiz.id}`)
      const chatIds = (chats || []).map((c: { id: string }) => c.id)
      if (!chatIds.length) return

      const { data: chatRows } = await sb
        .from('messages')
        .select('id,sender_id,text,created_at')
        .in('chat_id', chatIds)
        .neq('sender_id', myBiz.id)
        .gte('created_at', sinceIso)
        .ilike('text', `%${CHAT_CALL_INVITE_MARKER}%`)
        .order('created_at', { ascending: false })
        .limit(1)
      const chatLatest = chatRows?.[0] as { id?: string; sender_id?: string; text?: string } | undefined
      if (chatLatest?.sender_id && chatLatest.text?.includes('is calling you')) {
        handleChatInviteRow(chatLatest)
      }

      const { data: randRows } = await sb
        .from('messages')
        .select('id,sender_id,text,created_at')
        .in('chat_id', chatIds)
        .neq('sender_id', myBiz.id)
        .gte('created_at', sinceIso)
        .ilike('text', `%${RANDOM_CALL_INVITE_MARKER}%`)
        .order('created_at', { ascending: false })
        .limit(1)
      const randLatest = randRows?.[0] as { id?: string; sender_id?: string; text?: string } | undefined
      if (randLatest?.sender_id && randLatest.text?.includes('is calling you')) {
        handleRandomInviteRow(randLatest)
      }
    }

    const wrappedPoll = () => { void pollRecentInvites() }
    const interval = window.setInterval(wrappedPoll, 12_000)
    const onVis = () => {
      if (document.visibilityState === 'visible') wrappedPoll()
    }
    document.addEventListener('visibilitychange', onVis)
    wrappedPoll()
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [myBiz?.id, handleRandomInviteRow, handleChatInviteRow])

  useEffect(() => {
    if (!myBiz?.id) return
    void ensurePushSubscription(myBiz.id)
  }, [myBiz?.id])

  return (
    <AppCtx.Provider value={{
      user, myBiz, loading,
      tab, setTab, prevTab, setPrevTab,
      viewId, setViewId,
      chatWith, setChatWith,
      unread, setUnread,
      refreshBiz,
      toast, toastMsg, toastType, toastVisible,
      pendingRandomCallFromBusinessId, clearPendingRandomCall,
      pendingChatCallFromBusinessId, clearPendingChatCall,
      signOut
    }}>
      {children}
    </AppCtx.Provider>
  )
}
