import React, { useState } from 'react'
import { sb, uploadImage, getLastUploadError } from '../lib/db'
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
  const [phone, setPhone] = useState('')
  const [govIdUrl, setGovIdUrl] = useState('')
  const [uploadingGovId, setUploadingGovId] = useState(false)
  const [sendingReset, setSendingReset] = useState(false)
  const [err, setErr] = useState('')
  const [resetMsg, setResetMsg] = useState('')

  const uploadGovId = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setErr('')
    setResetMsg('')
    if (file.size > 20 * 1024 * 1024) {
      setErr('Government ID must be under 20MB')
      e.target.value = ''
      return
    }
    const allowed = file.type.startsWith('image/') || file.type === 'application/pdf'
    if (!allowed) {
      setErr('Only image or PDF files are allowed for ID upload')
      e.target.value = ''
      return
    }
    setUploadingGovId(true)
    const url = await uploadImage(file, 'kyc-ids')
    setUploadingGovId(false)
    e.target.value = ''
    if (!url) {
      setErr(getLastUploadError() || 'Failed to upload government ID')
      return
    }
    setGovIdUrl(url)
    toast('Government ID uploaded')
  }

  const sendReset = async () => {
    setErr('')
    setResetMsg('')
    if (!email) { setErr('Enter your email address first'); return }
    setSendingReset(true)
    const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin })
    setSendingReset(false)
    if (error) {
      setErr(error.message)
      return
    }
    setResetMsg('Password reset email sent. Please check your inbox.')
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    setResetMsg('')
    if (!email || !pw) { setErr('Please fill in all fields'); return }
    if (pw.length < 6) { setErr('Password must be at least 6 characters'); return }
    if (mode === 'register') {
      if (!first || !last) { setErr('Please enter your name'); return }
      if (!phone.trim()) { setErr('Phone number is required'); return }
      if (!govIdUrl) { setErr('Please upload your government ID'); return }
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
          options: { data: { first_name: first, last_name: last, phone: phone.trim(), gov_id_url: govIdUrl } }
        })
        if (error) setErr(error.message)
        else {
          toast('Welcome to Bizzkit! Set up your business profile.')
          setPhone('')
          setGovIdUrl('')
        }
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
        {mode === 'register' && (
          <div className="field">
            <label>Phone Number</label>
            <input type="tel" placeholder="+971 50 123 4567" value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" />
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
        {mode === 'login' && (
          <div style={{ marginTop:-4, marginBottom:12, textAlign:'right' }}>
            <button type="button" onClick={sendReset} disabled={sendingReset} style={{ background:'none', border:'none', color:'#4D9DFF', fontSize:12, fontWeight:700, cursor:'pointer', padding:0 }}>
              {sendingReset ? 'Sending reset link...' : 'Forgot your password?'}
            </button>
          </div>
        )}
        {mode === 'register' && (
          <div className="field">
            <label>Confirm Password</label>
            <input type="password" placeholder="Repeat password" value={pw2} onChange={e => setPw2(e.target.value)} />
          </div>
        )}
        {mode === 'register' && (
          <div className="field">
            <label>Government ID (Image or PDF)</label>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <label style={{ padding:'8px 14px', borderRadius:10, background:'#152236', border:'1px solid rgba(255,255,255,0.07)', color:'#7A92B0', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                {uploadingGovId ? 'Uploading ID...' : govIdUrl ? 'Change Uploaded ID' : 'Upload Government ID'}
                <input type="file" accept="image/*,.pdf,application/pdf" onChange={uploadGovId} style={{ display:'none' }} />
              </label>
              {govIdUrl && <span style={{ color:'#00D4A0', fontSize:11, fontWeight:700 }}>Uploaded</span>}
            </div>
          </div>
        )}
        {err && <div className="form-err">{err}</div>}
        {resetMsg && <div style={{ marginBottom:10, color:'#00D4A0', fontSize:12, fontWeight:600 }}>{resetMsg}</div>}
        <button type="submit" className="btn btn-blue btn-full" disabled={loading}>
          {loading ? 'Please wait…' : mode==='login' ? 'Sign In' : 'Create Account'}
        </button>
      </form>
    </div>
  )
}
