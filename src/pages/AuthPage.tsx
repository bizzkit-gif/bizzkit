import React, { useState } from 'react'
import { sb, uploadImage, getLastUploadError, INDUSTRIES, COUNTRIES, getLogo, grad, setAuthStorageMode } from '../lib/db'
import { useApp } from '../context/ctx'

type QuickBizFields = {
  name: string
  tagline: string
  industry: string
  city: string
  country: string
  description: string
}

async function trySaveOptionalBusinessProfile(
  userId: string,
  f: QuickBizFields
): Promise<{ ok: boolean; skipped: boolean; error?: string }> {
  if (!f.name.trim()) return { ok: true, skipped: true }
  const { data: existing } = await sb.from('businesses').select('id').eq('owner_id', userId).maybeSingle()
  if (existing) return { ok: true, skipped: true }
  const { error } = await sb.from('businesses').insert({
    owner_id: userId,
    name: f.name.trim(),
    tagline: f.tagline.trim(),
    description: f.description.trim() || 'Add more about your business in Profile.',
    industry: f.industry || 'Other',
    type: 'B2B',
    city: f.city.trim() || '—',
    country: f.country || 'Other',
    website: '',
    founded: '',
    logo: getLogo(f.name.trim()),
    grad: grad(userId),
    trust_score: 45,
    trust_tier: 'Bronze',
    kyc_verified: false,
    certified: false,
  })
  if (error) return { ok: false, skipped: false, error: error.message }
  return { ok: true, skipped: false }
}

export default function AuthPage() {
  const { toast, refreshBiz } = useApp()
  const [mode, setMode] = useState<'login' | 'register'>('login')
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
  const [bizName, setBizName] = useState('')
  const [bizTagline, setBizTagline] = useState('')
  const [bizInd, setBizInd] = useState('')
  const [bizCity, setBizCity] = useState('')
  const [bizCountry, setBizCountry] = useState('')
  const [bizDesc, setBizDesc] = useState('')
  const [keepLoggedIn, setKeepLoggedIn] = useState(true)

  const quickBiz = (): QuickBizFields => ({
    name: bizName,
    tagline: bizTagline,
    industry: bizInd,
    city: bizCity,
    country: bizCountry,
    description: bizDesc,
  })

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
    if (!email) {
      setErr('Enter your email address first')
      return
    }
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
    if (!email || !pw) {
      setErr('Please fill in all fields')
      return
    }
    if (pw.length < 6) {
      setErr('Password must be at least 6 characters')
      return
    }
    if (mode === 'register') {
      if (!first || !last) {
        setErr('Please enter your name')
        return
      }
      if (!phone.trim()) {
        setErr('Phone number is required')
        return
      }
      if (!govIdUrl) {
        setErr('Please upload your government ID')
        return
      }
      if (pw !== pw2) {
        setErr('Passwords do not match')
        return
      }
    }
    setLoading(true)
    try {
      if (mode === 'login') {
        setAuthStorageMode(keepLoggedIn ? 'local' : 'session')
        const { data, error } = await sb.auth.signInWithPassword({ email, password: pw })
        if (error) {
          setErr(error.message)
          return
        }
        if (data.user) {
          const save = await trySaveOptionalBusinessProfile(data.user.id, quickBiz())
          if (!save.ok && save.error) {
            toast(save.error, 'error')
          } else if (!save.skipped) {
            await refreshBiz()
            toast('Business profile saved.', 'success')
          }
        }
      } else {
        setAuthStorageMode(keepLoggedIn ? 'local' : 'session')
        const { data, error } = await sb.auth.signUp({
          email,
          password: pw,
          options: { data: { first_name: first, last_name: last, phone: phone.trim(), gov_id_url: govIdUrl } },
        })
        if (error) {
          setErr(error.message)
          return
        }
        toast('Welcome to Bizzkit! Set up your business profile.')
        setPhone('')
        setGovIdUrl('')
        if (data.user && data.session) {
          const save = await trySaveOptionalBusinessProfile(data.user.id, quickBiz())
          if (!save.ok && save.error) {
            toast(save.error, 'error')
          } else if (!save.skipped) {
            await refreshBiz()
            toast('Business profile saved.', 'success')
          }
        } else if (data.user && !data.session) {
          toast('Confirm your email from your inbox, then log in to finish your profile.', 'info', 5200)
        }
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100%', overflowY: 'auto', background: 'radial-gradient(ellipse at 50% -10%, rgba(30,126,247,0.18), transparent 55%), #0A1628' }}>
      <div style={{ textAlign: 'center', padding: '60px 0 20px' }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 42, fontWeight: 800, color: '#1E7EF7' }}>
          bizz<span style={{ color: '#FF6B35' }}>kit</span>
        </div>
        <div style={{ color: '#7A92B0', fontSize: 13, marginTop: 6 }}>The Business Showcase &amp; Networking Platform</div>
      </div>

      <div style={{ display: 'flex', margin: '0 18px 10px', background: '#152236', borderRadius: 13, padding: 4, border: '1px solid rgba(255,255,255,0.07)' }}>
        <button
          type="button"
          onClick={() => {
            setMode('login')
            setErr('')
          }}
          style={{
            flex: 1,
            padding: '10px 0',
            border: 'none',
            borderRadius: 10,
            background: mode === 'login' ? '#1E7EF7' : 'transparent',
            color: mode === 'login' ? '#fff' : '#7A92B0',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Log in
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('register')
            setErr('')
          }}
          style={{
            flex: 1,
            padding: '10px 0',
            border: 'none',
            borderRadius: 10,
            background: mode === 'register' ? '#1E7EF7' : 'transparent',
            color: mode === 'register' ? '#fff' : '#7A92B0',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Create account
        </button>
      </div>

      <p style={{ margin: '0 22px 16px', fontSize: 12, color: '#7A92B0', lineHeight: 1.5, textAlign: 'center' }}>
        {mode === 'login'
          ? 'Already signed up? Enter your email and password. You can add business details below before you sign in.'
          : 'New to Bizzkit? Fill in your details below. If you already have an account, switch to Log in.'}
      </p>

      <form onSubmit={submit} style={{ padding: '0 18px 48px' }}>
        {mode === 'register' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label>First Name</label>
              <input placeholder="Jane" value={first} onChange={(e) => setFirst(e.target.value)} />
            </div>
            <div className="field">
              <label>Last Name</label>
              <input placeholder="Smith" value={last} onChange={(e) => setLast(e.target.value)} />
            </div>
          </div>
        )}
        {mode === 'register' && (
          <div className="field">
            <label>Phone Number</label>
            <input type="tel" placeholder="+971 50 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
          </div>
        )}
        <div className="field">
          <label>Email Address</label>
          <input type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" placeholder={mode === 'register' ? 'Min. 6 characters' : '••••••••'} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: -2, marginBottom: mode === 'login' ? 10 : 12, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: '#C8D4E8', fontWeight: 600, userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={keepLoggedIn}
              onChange={(e) => setKeepLoggedIn(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: '#1E7EF7', cursor: 'pointer' }}
            />
            Keep me logged in
          </label>
          {mode === 'login' && (
            <button type="button" onClick={sendReset} disabled={sendingReset} style={{ background: 'none', border: 'none', color: '#4D9DFF', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0, marginLeft: 'auto' }}>
              {sendingReset ? 'Sending reset link...' : 'Forgot your password?'}
            </button>
          )}
        </div>
        {mode === 'register' && (
          <div className="field">
            <label>Confirm Password</label>
            <input type="password" placeholder="Repeat password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
          </div>
        )}
        {mode === 'register' && (
          <div className="field">
            <label>Government ID (Image or PDF)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <label style={{ padding: '8px 14px', borderRadius: 10, background: '#152236', border: '1px solid rgba(255,255,255,0.07)', color: '#7A92B0', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {uploadingGovId ? 'Uploading ID...' : govIdUrl ? 'Change Uploaded ID' : 'Upload Government ID'}
                <input type="file" accept="image/*,.pdf,application/pdf" onChange={uploadGovId} style={{ display: 'none' }} />
              </label>
              {govIdUrl && (
                <span style={{ color: '#00D4A0', fontSize: 11, fontWeight: 700 }}>Uploaded</span>
              )}
            </div>
          </div>
        )}

        <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>Business profile (optional)</div>
          <div style={{ fontSize: 11, color: '#7A92B0', marginBottom: 12, lineHeight: 1.45 }}>
            Save time: add your company name and details here. They are saved when you {mode === 'login' ? 'log in' : 'create your account'} (if you do not already have a business profile). Edit anytime in Profile.
          </div>
          <div className="field">
            <label>Business name</label>
            <input placeholder="e.g. NexaTech Solutions" value={bizName} onChange={(e) => setBizName(e.target.value)} />
          </div>
          <div className="field">
            <label>Tagline</label>
            <input placeholder="Short tagline" value={bizTagline} onChange={(e) => setBizTagline(e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
            <div className="field">
              <label>Industry</label>
              <select value={bizInd} onChange={(e) => setBizInd(e.target.value)}>
                <option value="">Select…</option>
                {INDUSTRIES.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Type</label>
              <select defaultValue="B2B" disabled style={{ opacity: 0.7 }}>
                <option value="B2B">B2B</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
            <div className="field">
              <label>City</label>
              <input placeholder="Dubai" value={bizCity} onChange={(e) => setBizCity(e.target.value)} />
            </div>
            <div className="field">
              <label>Country</label>
              <select value={bizCountry} onChange={(e) => setBizCountry(e.target.value)}>
                <option value="">Select…</option>
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Short description</label>
            <textarea placeholder="What does your business do?" value={bizDesc} onChange={(e) => setBizDesc(e.target.value)} style={{ minHeight: 64 }} />
          </div>
        </div>

        {err && <div className="form-err">{err}</div>}
        {resetMsg && (
          <div style={{ marginBottom: 10, color: '#00D4A0', fontSize: 12, fontWeight: 600 }}>{resetMsg}</div>
        )}
        <button type="submit" className="btn btn-blue btn-full" disabled={loading} style={{ marginTop: 8 }}>
          {loading ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
        </button>
      </form>
    </div>
  )
}
