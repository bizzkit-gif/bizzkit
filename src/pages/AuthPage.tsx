import React, { useState } from 'react'
import { sb } from '../lib/db'
import { useApp } from '../context/ctx'

export default function AuthPage() {
  const { toast } = useApp()
  const [mode, setMode] = useState<'login'|'register'|'reset'>('login')
  const [loading, setLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [err, setErr] = useState('')
  const [resetSent, setResetSent] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')

    if (mode === 'reset') {
      if (!email) { setErr('Please enter your email address'); return }
      setLoading(true)
      const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/?reset=true'
      })
      setLoading(false)
      if (error) setErr(error.message)
      else setResetSent(true)
      return
    }

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

      {mode !== 'reset' && (
        <div style={{ display:'flex', margin:'0 18px 18px', background:'#152236', borderRadius:13, padding:4, border:'1px solid rgba(255,255,255,0.07)' }}>
          <button onClick={() => { setMode('login'); setErr('') }} style={{ flex:1, padding:'8px 0', border:'none', borderRadius:10, background:mode==='login'?'#1E7EF7':'transparent', color:mode==='login'?'#fff':'#7A92B0', fontSize:13, fontWeight:700, cursor:'pointer' }}>
            Sign In
          </button>
          <button onClick={() => { setMode('register'); setErr('') }} style={{ flex:1, padding:'8px 0', border:'none', borderRadius:10, background:mode==='register'?'#1E7EF7':'transparent', color:mode==='register'?'#fff':'#7A92B0', fontSize:13, fontWeight:700, cursor:'pointer' }}>
            Create Account
          </button>
        </div>
      )}

      {mode === 'reset' && (
        <div style={{ margin:'0 18px 18px', background:'rgba(30,126,247,0.1)', border:'1px solid rgba(30,126,247,0.2)', borderRadius:13, padding:'14px 16px' }}>
          <div style={{ fontSize:13, fontWeight:700, color:'#fff', marginBottom:4 }}>Reset your password</div>
          <div style={{ fontSize:12, color:'#7A92B0' }}>Enter your email and we'll send you a reset link</div>
        </div>
      )}

      {resetSent ? (
        <div style={{ padding:'0 18px' }}>
          <div style={{ background:'rgba(0,212,160,0.1)', border:'1px solid rgba(0,212,160,0.3)', borderRadius:13, padding:'20px 16px', textAlign:'center' }}>
            <div style={{ fontSize:32, marginBottom:12 }}>📧</div>
            <div style={{ fontSize:15, fontWeight:700, color:'#fff', marginBottom:8 }}>Check your email</div>
            <div style={{ fontSize:13, color:'#7A92B0', lineHeight:1.6 }}>
              We sent a password reset link to<br/>
              <span style={{ color:'#fff', fontWeight:600 }}>{email}</span>
            </div>
            <button onClick={() => { setMode('login'); setResetSent(false); setErr('') }} style={{ marginTop:20, padding:'10px 24px', background:'#1E7EF7', border:'none', borderRadius:10, color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer' }}>
              Back to Sign In
            </button>
          </div>
        </div>
      ) : (
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
          {mode !== 'reset' && (
            <div className="field">
              <label>Password</label>
              <input type="password" placeholder={mode==='register'?'Min. 6 characters':'••••••••'} value={pw} onChange={e => setPw(e.target.value)} />
            </div>
          )}
          {mode === 'register' && (
            <div className="field">
              <label>Confirm Password</label>
              <input type="password" placeholder="Repeat password" value={pw2} onChange={e => setPw2(e.target.value)} />
            </div>
          )}
          {mode === 'login' && (
            <div style={{ textAlign:'right', marginTop:-8, marginBottom:14 }}>
              <span onClick={() => { setMode('reset'); setErr('') }} style={{ fontSize:12, color:'#1E7EF7', cursor:'pointer', fontWeight:600 }}>
                Forgot password?
              </span>
            </div>
          )}
          {err && <div className="form-err">{err}</div>}
          <button type="submit" className="btn btn-blue btn-full" disabled={loading}>
            {loading ? 'Please wait…' : mode==='login' ? 'Sign In' : mode==='register' ? 'Create Account' : 'Send Reset Link'}
          </button>
          {mode === 'reset' && (
            <button type="button" onClick={() => { setMode('login'); setErr('') }} style={{ width:'100%', marginTop:10, padding:'11px 16px', background:'transparent', border:'1px solid rgba(255,255,255,0.07)', borderRadius:12, color:'#7A92B0', fontSize:13, fontWeight:700, cursor:'pointer' }}>
              Back to Sign In
            </button>
          )}
        </form>
      )}
    </div>
  )
}
