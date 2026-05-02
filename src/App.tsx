import React, { useEffect, useLayoutEffect, lazy, Suspense } from 'react'
import { useApp } from './context/ctx'
import { ErrorBoundary } from './components/ErrorBoundary'
import AuthPage from './pages/AuthPage'
import FeedPage from './pages/FeedPage'

const MessagesPage = lazy(() => import('./pages/MessagesPage'))
const LegalPage = lazy(() => import('./pages/LegalPage'))
const NotificationSettingsPage = lazy(() => import('./pages/NotificationSettingsPage'))
const ProfilePage = lazy(() => import('./pages/OtherPages').then((m) => ({ default: m.ProfilePage })))
const ConferencePage = lazy(() => import('./pages/OtherPages').then((m) => ({ default: m.ConferencePage })))
const GoRandomPage = lazy(() => import('./pages/OtherPages').then((m) => ({ default: m.GoRandomPage })))
const TrustPage = lazy(() => import('./pages/OtherPages').then((m) => ({ default: m.TrustPage })))
const KycFormPage = lazy(() => import('./pages/OtherPages').then((m) => ({ default: m.KycFormPage })))

/** Thin fallback — tab chunks are prefetched after login so this rarely shows. */
function TabLoading() {
  return (
    <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 160, padding: 20 }}>
      <div className="spinner" aria-hidden />
    </div>
  )
}

const NAV = [
  { id:'feed',       icon:'🏠', label:'Home'    },
  { id:'conference', icon:'📅', label:'Connect' },
  { id:'random',     icon:'🎲', label:'Explore' },
  { id:'messages',   icon:'💬', label:'Messages' },
  { id:'profile',    icon:'🏢', label:'Profile' },
]

function MainBottomNav({ dimmed }: { dimmed?: boolean }) {
  const { tab, setTab, setPrevTab, setViewId, unread, pendingRandomCallFromBusinessId, pendingChatCallFromBusinessId } = useApp()
  const go = (t: string) => {
    setPrevTab(tab)
    setTab(t)
    if (t !== 'profile' && t !== 'legal' && t !== 'notifications') setViewId(null)
  }
  return (
    <nav className={`bnav${dimmed ? ' bnav-dimmed' : ''}`} aria-hidden={dimmed || undefined}>
      {NAV.map(n => (
        <div key={n.id} className={`bni${tab===n.id||(n.id==='profile'&&(tab==='trust'||tab==='kyc'))?' on':''}`} onClick={() => { if (dimmed) return; go(n.id) }}>
          <div className="bni-ico">
            {n.icon}
            {n.id==='messages'&&(unread>0||!!pendingChatCallFromBusinessId)&&<div className="bni-badge">{unread>0?(unread>9?'9+':unread):'!'}</div>}
            {n.id==='random'&&!!pendingRandomCallFromBusinessId&&<div className="bni-badge">!</div>}
          </div>
          <span className="bni-lbl">{n.label}</span>
        </div>
      ))}
    </nav>
  )
}

/** Same chrome as Home while auth hydrates — avoids a second “blank” after HTML boot splash. */
function HomeSessionBootChrome() {
  return (
    <div style={{ paddingBottom: 16 }}>
      <div className="topbar">
        <div className="logo-txt">
          bizz<span>kit</span>
        </div>
        <div className="icon-btn" aria-hidden style={{ opacity: 0.85 }}>
          🔔
        </div>
      </div>
      <div className="search-wrap" aria-hidden style={{ opacity: 0.7 }}>
        <span style={{ fontSize: 15, color: '#7A92B0' }}>🔍</span>
        <span style={{ flex: 1, fontSize: 13, color: '#5A7088' }}> </span>
      </div>
      <div
        style={{
          margin: '0 16px 12px',
          display: 'flex',
          background: '#152236',
          borderRadius: 12,
          padding: 4,
          border: '1px solid rgba(255,255,255,0.07)',
          gap: 2,
        }}
        aria-hidden
      >
        {(['Home', 'Explore', 'Connected'] as const).map((label, i) => (
          <div
            key={label}
            style={{
              flex: 1,
              borderRadius: 9,
              padding: '8px 6px',
              textAlign: 'center',
              fontSize: 10.5,
              fontWeight: 700,
              background: i === 0 ? '#1E7EF7' : 'transparent',
              color: i === 0 ? '#fff' : '#7A92B0',
            }}
          >
            {label}
          </div>
        ))}
      </div>
      <div className="chips" aria-hidden style={{ opacity: 0.65, pointerEvents: 'none' }}>
        {['All', 'Technology', 'Retail', 'Finance'].map((c) => (
          <div key={c} className="chip">
            {c}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function App() {
  const { user, loading, bootLikelyAuthed, tab, setTab, prevTab, setPrevTab, viewId, setViewId, chatWith, setChatWith, unread, toastMsg, toastType, toastVisible, pendingRandomCallFromBusinessId, pendingChatCallFromBusinessId } = useApp()

  /** Warm secondary-route chunks after login so tab switches stay instant without shipping everything in the first bundle. */
  useEffect(() => {
    if (!user) return
    const load = () => {
      void import('./pages/MessagesPage')
      void import('./pages/LegalPage')
      void import('./pages/NotificationSettingsPage')
      void import('./pages/OtherPages')
    }
    let idleId: number | undefined
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(load, { timeout: 2000 })
    } else {
      timeoutId = setTimeout(load, 180)
    }
    return () => {
      if (idleId !== undefined && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleId)
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    }
  }, [user])

  useLayoutEffect(() => {
    if (!loading) {
      const splash = document.getElementById('bk-pwa-splash')
      splash?.parentNode?.removeChild(splash)
    }
  }, [loading])

  /** Until the first session resolves, `user` is null — do not render Auth (logged-in users would flash login → app on cold start / PWA). */
  if (loading) {
    if (bootLikelyAuthed) {
      return (
        <div className="shell">
          <div className="screen-area">
            <div className="screen">
              <HomeSessionBootChrome />
            </div>
          </div>
          <MainBottomNav dimmed />
        </div>
      )
    }
    return (
      <div className="shell">
        <div className="screen-area">
          <div className="screen">
            <div className="loading">
              <div className="loading-logo">
                Biz<span>z</span>kit
              </div>
              <div className="spinner" aria-hidden />
            </div>
          </div>
        </div>
      </div>
    )
  }

  const go = (t: string) => {
    setPrevTab(tab)
    setTab(t)
    if (t !== 'profile' && t !== 'legal' && t !== 'notifications') setViewId(null)
  }
  const viewBiz = (id: string) => { setViewId(id); setPrevTab(tab); setTab('profile') }
  const openChat = (id: string) => { setChatWith(id); setPrevTab(tab); setTab('messages') }

  if (!user) {
    return (
      <div className="shell">
        <div className="screen-area">
          <div className="screen">
            <AuthPage />
          </div>
        </div>
      </div>
    )
  }

  const screen = () => {
    if (tab==='feed')       return <FeedPage onView={viewBiz} />
    if (tab==='profile')    return <ProfilePage viewId={viewId} onBack={viewId?()=>{setViewId(null);setTab(prevTab)}:undefined} onChat={openChat} onTrust={() => go('trust')} />
    if (tab==='conference') return <ConferencePage />
    if (tab==='random')     return <GoRandomPage />
    if (tab==='messages')   return <MessagesPage openWith={chatWith} onClearOpen={() => setChatWith(null)} />
    if (tab==='trust')      return <TrustPage onOpenKyc={() => go('kyc')} />
    if (tab==='kyc')        return <KycFormPage onBack={() => go('trust')} />
    if (tab==='legal')      return <LegalPage onBack={() => setTab(prevTab)} />
    if (tab==='notifications') return <NotificationSettingsPage onBack={() => setTab(prevTab)} />
    return <FeedPage onView={viewBiz} />
  }

  return (
    <div className="shell">
      <div className="screen-area">
        <ErrorBoundary key={tab + (viewId || '')}>
          <Suspense fallback={<TabLoading />}>
            <div className={`screen${tab === 'random' || tab === 'messages' ? ' screen-fit' : ''}`}>{screen()}</div>
          </Suspense>
        </ErrorBoundary>
      </div>
      <MainBottomNav />
      <div className={`toast${toastVisible?' show':''}${toastType==='error'?' err':toastType==='info'?' info':''}`}>{toastMsg}</div>
    </div>
  )
}
