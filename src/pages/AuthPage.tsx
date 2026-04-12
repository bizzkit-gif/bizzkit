import React, { useState } from 'react'
import { sb } from '../lib/db'
import { useApp } from '../context/ctx'

export default function AuthPage() {
  const { toast } = useApp()
  const [mode, setMode] = useState<'login'|'register'>('login')
  const [loading, setLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [err, setErr] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    if (!email || !pw) { setErr('Please fill in all fields'); return }
    if (pw.length < 6) { setErr('Password must be at least 6 characters'); return }
    if (mode === 'register') {
      if (!first || !last) { setErr('Please enter your name'); return }
      if (pw !== pw2) { setErr('Passwords do not match'); return }
    }
    setLoading(true)
    try {
      if (mode === 'login') {
        const { error } = await sb.auth.signInWithPassword({ email, password: pw })
        if (error) setErr(error.message)
      } else {
        const { error } = await sb.auth.signUp({
          email, password: pw,
          options: { data: { first_name: first, last_name: last } }
        })
        if (error) setErr(error.message)
        else toast('Welcome to Bizzkit! Set up your business profile.')
      }
    } catch(e: any) {
      setErr(e.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight:'100%', overflowY:'auto', background:'radial-gradient(ellipse at 50% -10%, rgba(30,126,247,0.18), transparent 55%), #0A1628' }}>
      <div style={{ textAlign:'center', padding:'60px 0 24px' }}>
        <div style={{ fontFamily:'Syne, sans-serif', fontSize:42, fontWeight:800, color:'#1E7EF7' }}>
          bizz<span style={{ color:'#FF6B35' }}>kit</span>
        </div>
        <div style={{ color:'#7A92B0', fontSize:13, marginTop:6 }}>
          The Business Showcase &amp; Networking Platform
        </div>
      </div>

      <div style={{ display:'flex', margin:'0 18px 18px', background:'#152236', borderRadius:13, padding:4, border:'1px solid rgba(255,255,255,0.07)' }}>
        <button onClick={() => { setMode('login'); setErr('') }} style={{ flex:1, padding:'8px 0', border:'none', borderRadius:10, background:mode==='login'?'#1E7EF7':'transparent', color:mode==='login'?'#fff':'#7A92B0', fontSize:13, fontWeight:700, cursor:'pointer' }}>
          Sign In
        </button>
        <button onClick={() => { setMode('register'); setErr('') }} style={{ flex:1, padding:'8px 0', border:'none', borderRadius:10, background:mode==='register'?'#1E7EF7':'transparent', color:mode==='register'?'#fff':'#7A92B0', fontSize:13, fontWeight:700, cursor:'pointer' }}>
          Create Account
        </button>
      </div>

      <form onSubmit={submit} style={{ padding:'0 18px 40px' }}>
        {mode === 'register' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div className="field"><label>First Name</label><input placeholder="Jane" value={first} onChange={e => setFirst(e.target.value)} /></div>
            <div className="field"><label>Last Name</label><input placeholder="Smith" value={last} onChange={e => setLast(e.target.value)} /></div>
          </div>
        )}
        <div className="field">
          <label>Email Address</label>
          <input type="email" placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" placeholder={mode==='register'?'Min. 6 characters':'••••••••'} value={pw} onChange={e => setPw(e.target.value)} />
        </div>
        {mode === 'register' && (
          <div className="field">
            <label>Confirm Password</label>
            <input type="password" placeholder="Repeat password" value={pw2} onChange={e => setPw2(e.target.value)} />
          </div>
        )}
        {err && <div className="form-err">{err}</div>}
        <button type="submit" className="btn btn-blue btn-full" disabled={loading}>
          {loading ? 'Please wait…' : mode==='login' ? 'Sign In' : 'Create Account'}
        </button>
      </form>
    </div>
  )
}
