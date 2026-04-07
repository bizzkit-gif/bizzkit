import React, { useState, useEffect } from 'react'
import { useApp } from './context/ctx'
import AuthPage from './pages/AuthPage'
import FeedPage from './pages/FeedPage'
import MessagesPage from './pages/MessagesPage'
import { ProfilePage, ConferencePage, GoRandomPage, TrustPage } from './pages/OtherPages'

const NAV = [
  { id:'feed',       icon:'🏠', label:'Feed'    },
  { id:'conference', icon:'📅', label:'Connect' },
  { id:'random',     icon:'🎲', label:'Random'  },
  { id:'messages',   icon:'💬', label:'Chat'    },
  { id:'profile',    icon:'🏢', label:'Profile' },
]

export default function App() {
  const { user, loading, tab, setTab, prevTab, setPrevTab, viewId, setViewId, chatWith, setChatWith, unread, toastMsg, toastType, toastVisible } = useApp()
  const [time, setTime] = useState('9:41')

  useEffect(() => {
    const tick = () => { const n = new Date(); setTime(n.getHours()+':'+String(n.getMinutes()).padStart(2,'0')) }
    tick()
    const t = setInterval(tick, 30000)
    return () => clearInterval(t)
  }, [])

  const go = (t: string) => { setPrevTab(tab); setTab(t); if(t!=='profile') setViewId(null) }
  const viewBiz = (id: string) => { setViewId(id); setPrevTab(tab); setTab('profile') }
  const openChat = (id: string) => { setChatWith(id); setPrevTab(tab); setTab('messages') }

  // Always show auth if no user, even during loading
 const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const isStandalone = (window.navigator as any).standalone
  const [showBanner, setShowBanner] = React.useState(isIOS && !isStandalone)

  if (!user) return (
    <div className="shell">
      {showBanner && (
        <div style={{ background:'#1E7EF7', padding:'10px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <div style={{ fontSize:12, color:'#fff', fontWeight:600 }}>📲 Add to Home Screen for best experience</div>
          <span onClick={() => setShowBanner(false)} style={{ color:'#fff', fontSize:18, cursor:'pointer' }}>×</span>
        </div>
      )}
      <div className="screen-area">
        <div className="screen"><AuthPage /></div>
      </div>
    </div>
  )

  const screen = () => {
    if (tab==='feed')       return <FeedPage onView={viewBiz} />
    if (tab==='profile')    return <ProfilePage viewId={viewId} onBack={viewId?()=>{setViewId(null);setTab(prevTab)}:undefined} onChat={openChat} onTrust={() => go('trust')} />
    if (tab==='conference') return <ConferencePage />
    if (tab==='random')     return <GoRandomPage />
    if (tab==='messages')   return <MessagesPage openWith={chatWith} onClearOpen={() => setChatWith(null)} />
    if (tab==='trust')      return <TrustPage />
    return <FeedPage onView={viewBiz} />
  }

  return (
    <div className="shell">
      <div className="sbar" style={{ display:'none' }}>
        <div className="sbar-t">{time}</div>
        <div className="sbar-r"><span>WiFi</span><span>100%</span></div>
      </div>
      <div className="screen-area">
        <div className="screen" key={tab+(viewId||'')}>{screen()}</div>
      </div>
      <nav className="bnav">
        {NAV.map(n => (
          <div key={n.id} className={`bni${tab===n.id||(n.id==='profile'&&tab==='trust')?' on':''}`} onClick={() => go(n.id)}>
            <div className="bni-ico">
              {n.icon}
              {n.id==='messages'&&unread>0&&<div className="bni-badge">{unread>9?'9+':unread}</div>}
            </div>
            <span className="bni-lbl">{n.label}</span>
          </div>
        ))}
      </nav>
      <div className={`toast${toastVisible?' show':''}${toastType==='error'?' err':toastType==='info'?' info':''}`}>{toastMsg}</div>
    </div>
  )
}
