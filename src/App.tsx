import React from 'react'
import { useApp } from './context/ctx'
import AuthPage from './pages/AuthPage'
import FeedPage from './pages/FeedPage'
import MessagesPage from './pages/MessagesPage'
import { ProfilePage, ConferencePage, GoRandomPage, TrustPage, KycFormPage } from './pages/OtherPages'

const NAV = [
  { id:'feed',       icon:'🏠', label:'Feed'    },
  { id:'conference', icon:'📅', label:'Connect' },
  { id:'random',     icon:'🎲', label:'Random'  },
  { id:'messages',   icon:'💬', label:'Chat'    },
  { id:'profile',    icon:'🏢', label:'Profile' },
]

export default function App() {
  const { user, loading, tab, setTab, prevTab, setPrevTab, viewId, setViewId, chatWith, setChatWith, unread, toastMsg, toastType, toastVisible, pendingRandomCallFromBusinessId, pendingChatCallFromBusinessId } = useApp()

  const go = (t: string) => { setPrevTab(tab); setTab(t); if(t!=='profile') setViewId(null) }
  const viewBiz = (id: string) => { setViewId(id); setPrevTab(tab); setTab('profile') }
  const openChat = (id: string) => { setChatWith(id); setPrevTab(tab); setTab('messages') }

  // Always show auth if no user, even during loading
  if (!user) return (
    <div className="shell">
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
    if (tab==='trust')      return <TrustPage onOpenKyc={() => go('kyc')} />
    if (tab==='kyc')        return <KycFormPage onBack={() => go('trust')} />
    return <FeedPage onView={viewBiz} />
  }

  return (
    <div className="shell">
      <div className="screen-area">
        <div className={`screen${tab === 'random' ? ' screen-fit' : ''}`} key={tab+(viewId||'')}>{screen()}</div>
      </div>
      <nav className="bnav">
        {NAV.map(n => (
          <div key={n.id} className={`bni${tab===n.id||(n.id==='profile'&&(tab==='trust'||tab==='kyc'))?' on':''}`} onClick={() => go(n.id)}>
            <div className="bni-ico">
              {n.icon}
              {n.id==='messages'&&(unread>0||!!pendingChatCallFromBusinessId)&&<div className="bni-badge">{unread>0?(unread>9?'9+':unread):'!'}</div>}
              {n.id==='random'&&!!pendingRandomCallFromBusinessId&&<div className="bni-badge">!</div>}
            </div>
            <span className="bni-lbl">{n.label}</span>
          </div>
        ))}
      </nav>
      <div className={`toast${toastVisible?' show':''}${toastType==='error'?' err':toastType==='info'?' info':''}`}>{toastMsg}</div>
    </div>
  )
}
