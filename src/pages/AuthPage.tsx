import React, { useState, useEffect } from 'react'
import { sb, uploadImage, getLastUploadError, INDUSTRIES, COUNTRIES, getLogo, grad, setAuthStorageMode } from '../lib/db'
import { emailHasStoredProfile } from '../lib/profileLocal'
import { useApp } from '../context/ctx'

type QuickBizFields = {
  name: string
  tagline: string
  industry: string
  city: string
  country: string
  description: string
}

const PENDING_QUICK_BIZ_KEY = 'bizzkit.pendingQuickBiz.v1'

type PendingQuickBiz = {
  userId: string
  email: string
  fields: QuickBizFields
  savedAt: number
}

function readPendingQuickBiz(): PendingQuickBiz | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(PENDING_QUICK_BIZ_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PendingQuickBiz
    if (!parsed || typeof parsed !== 'object') return null
    if (!parsed.userId || !parsed.email || !parsed.fields) return null
    return parsed
  } catch {
    return null
  }
}

function writePendingQuickBiz(value: PendingQuickBiz): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(PENDING_QUICK_BIZ_KEY, JSON.stringify(value))
  } catch {
    /* ignore quota */
  }
}

function clearPendingQuickBiz(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(PENDING_QUICK_BIZ_KEY)
  } catch {
    /* ignore */
  }
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
    followers: 0,
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
  const [showRegisterAnyway, setShowRegisterAnyway] = useState(false)

  const emailNorm = email.trim().toLowerCase()
  const hasStoredProfile = emailNorm.length > 0 && emailHasStoredProfile(emailNorm)
  const simplifiedLogin = hasStoredProfile && !showRegisterAnyway

  useEffect(() => {
    if (simplifiedLogin) setMode('login')
  }, [simplifiedLogin])

  useEffect(() => {
    setShowRegisterAnyway(false)
  }, [emailNorm])

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
          const pending = readPendingQuickBiz()
          const pendingForUser =
            pending &&
            pending.userId === data.user.id &&
            pending.email === email.trim().toLowerCase()
              ? pending.fields
              : null
          const save = await trySaveOptionalBusinessProfile(data.user.id, pendingForUser || quickBiz())
          if (!save.ok && save.error) {
            toast(save.error, 'error')
            if (pendingForUser) {
              toast('We could not restore your pending business profile yet. Please retry after login.', 'info', 5200)
            }
          } else if (!save.skipped) {
            await refreshBiz()
            if (pendingForUser) {
              toast('Business profile restored and saved.', 'success')
            } else {
              toast('Business profile saved.', 'success')
            }
            clearPendingQuickBiz()
          } else if (pendingForUser) {
            // If profile already exists now, no need to keep stale draft.
            clearPendingQuickBiz()
          }
        }
      } else {
        setAuthStorageMode(keepLoggedIn ? 'local' : 'session')
        const { data, error } = await sb.auth.signUp({
          email,
          password: pw,
          options: {
            data: {
              first_name: first,
              last_name: last,
              phone: phone.trim(),
              ...(govIdUrl.trim() ? { gov_id_url: govIdUrl } : {}),
            },
          },
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
          clearPendingQuickBiz()
        } else if (data.user && !data.session) {
          const draft = quickBiz()
          if (draft.name.trim()) {
            writePendingQuickBiz({
              userId: data.user.id,
              email: email.trim().toLowerCase(),
              fields: draft,
              savedAt: Date.now(),
            })
            toast('Confirm email from inbox. Your business profile draft is saved and will auto-restore on first login.', 'info', 6200)
          } else {
            toast('Confirm your email from your inbox, then log in to finish your profile.', 'info', 5200)
          }
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

      <div style={{ margin: '0 18px 10px', padding: '12px 8px', textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#E8EEF5' }}>
          {mode === 'register' && !simplifiedLogin ? 'Create account' : 'Log in'}
        </div>
      </div>

      <p style={{ margin: '0 22px 16px', fontSize: 12, color: '#7A92B0', lineHeight: 1.5, textAlign: 'center' }}>
        {simplifiedLogin
          ? 'Welcome back. Enter your password to continue.'
          : mode === 'login'
            ? 'Already signed up? Enter your email and password.'
            : 'New to Bizzkit? Fill in your details below.'}
      </p>

      {mode === 'login' && (
        <p style={{ margin: '0 22px 14px', fontSize: 12, textAlign: 'center' }}>
          <button
            type="button"
            onClick={() => {
              setShowRegisterAnyway(true)
              setMode('register')
              setErr('')
            }}
            style={{ background: 'none', border: 'none', color: '#4D9DFF', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
          >
            New here? Create an account
          </button>
        </p>
      )}

      {mode === 'register' && !simplifiedLogin && (
        <p style={{ margin: '0 22px 14px', fontSize: 12, textAlign: 'center' }}>
          <button
            type="button"
            onClick={() => {
              setMode('login')
              setErr('')
            }}
            style={{ background: 'none', border: 'none', color: '#4D9DFF', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
          >
            Already have an account? Log in
          </button>
        </p>
      )}

      <form onSubmit={submit} style={{ padding: '0 18px 48px' }}>
        {mode === 'register' && !simplifiedLogin && (
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
        {mode === 'register' && !simplifiedLogin && (
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
          <label
            htmlFor="auth-keep-logged-in"
            style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: '#C8D4E8', fontWeight: 600, userSelect: 'none', flex: '0 1 auto', minWidth: 0 }}
          >
            <input
              id="auth-keep-logged-in"
              type="checkbox"
              checked={keepLoggedIn}
              onChange={(e) => setKeepLoggedIn(e.target.checked)}
              style={{ flexShrink: 0, width: 18, height: 18, accentColor: '#1E7EF7', cursor: 'pointer', margin: 0 }}
            />
            <span>Keep me logged in</span>
          </label>
          {mode === 'login' && (
            <button type="button" onClick={sendReset} disabled={sendingReset} style={{ background: 'none', border: 'none', color: '#4D9DFF', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0, marginLeft: 'auto' }}>
              {sendingReset ? 'Sending reset link...' : 'Forgot your password?'}
            </button>
          )}
        </div>
        {mode === 'register' && !simplifiedLogin && (
          <div className="field">
            <label>Confirm Password</label>
            <input type="password" placeholder="Repeat password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
          </div>
        )}
        {mode === 'register' && !simplifiedLogin && (
          <div className="field">
            <label>Government ID (optional)</label>
            <div style={{ fontSize: 11, color: '#7A92B0', marginBottom: 8, lineHeight: 1.4 }}>Image or PDF. You can add this later in Profile / Trust &amp; KYC.</div>
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

        {mode === 'register' && !simplifiedLogin && (
          <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>Business profile (optional)</div>
            <div style={{ fontSize: 11, color: '#7A92B0', marginBottom: 12, lineHeight: 1.45 }}>
              Save time: add your company name and details here. They are saved when you create your account (if you do not already have a business profile). Edit anytime in Profile.
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
        )}

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
