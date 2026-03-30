import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
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
  refreshBiz: () => Promise<void>
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

  const toast = useCallback((msg: string, type: ToastType = 'success') => {
    setToastMsg(msg)
    setToastType(type)
    setToastVisible(true)
    setTimeout(() => setToastVisible(false), 2800)
  }, [])

  const refreshBiz = useCallback(async () => {
    if (!user) return
    try {
      const { data } = await sb.from('businesses').select('*,products(*)').eq('owner_id', user.id).single()
      setMyBiz(data || null)
    } catch {
      setMyBiz(null)
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
