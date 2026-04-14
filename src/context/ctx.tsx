import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { sb, Business } from '../lib/db'

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
  toast: (msg: string, type?: ToastType) => void
  toastMsg: string
  toastType: string
  toastVisible: boolean
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
  const unreadRef = useRef(0)

  const toast = useCallback((msg: string, type: ToastType = 'success') => {
    setToastMsg(msg)
    setToastType(type)
    setToastVisible(true)
    setTimeout(() => setToastVisible(false), 2800)
  }, [])

  const refreshBiz = useCallback(async (): Promise<Business | null> => {
    if (!user) return null
    try {
      const { data } = await sb.from('businesses').select('*,products(*)').eq('owner_id', user.id).single()
      const nextBiz = data || null
      setMyBiz(nextBiz)
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

    refreshUnread()
    const ch = sb.channel('global-unread-' + myBiz.id)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'messages' }, async (payload) => {
        const row = payload.new as { chat_id?: string; sender_id?: string }
        if (!row?.chat_id || !row?.sender_id || row.sender_id === myBiz.id) return
        const { data: chat } = await sb.from('chats').select('participant_a,participant_b').eq('id', row.chat_id).single()
        if (!chat) return
        const isMine = chat.participant_a === myBiz.id || chat.participant_b === myBiz.id
        if (!isMine) return
        const prevUnread = unreadRef.current
        await refreshUnread()
        if (unreadRef.current > prevUnread) {
          if (navigator.vibrate) navigator.vibrate([120, 60, 120])
          if (tab !== 'messages') toast('New message received 💬', 'info')
        }
      })
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'messages' }, refreshUnread)
      .subscribe()

    return () => {
      active = false
      sb.removeChannel(ch)
    }
  }, [myBiz?.id, tab, toast])

  return (
    <AppCtx.Provider value={{
      user, myBiz, loading,
      tab, setTab, prevTab, setPrevTab,
      viewId, setViewId,
      chatWith, setChatWith,
      unread, setUnread,
      refreshBiz,
      toast, toastMsg, toastType, toastVisible
    }}>
      {children}
    </AppCtx.Provider>
  )
}
