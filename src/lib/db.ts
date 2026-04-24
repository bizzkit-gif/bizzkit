import { createClient } from '@supabase/supabase-js'

// Keys hardcoded - no .env file needed
export const SUPABASE_URL = 'https://ganberetmowmaidioryu.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdhbmJlcmV0bW93bWFpZGlvcnl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4OTg5MzksImV4cCI6MjA4OTQ3NDkzOX0.5-mD0cFberNXOmSh8F0lItV6wbTJE0zHjCiPFAYfExE'
/** Same as Supabase anon key — used for invoking Edge Functions from the browser. */
export const SUPABASE_ANON_KEY = SUPABASE_KEY

const AUTH_STORAGE_MODE_KEY = 'bizzkit.auth.storageMode'

export type AuthStorageMode = 'local' | 'session'

/** Call before signIn / signUp so the session is stored in localStorage (keep logged in) or sessionStorage (this browser session only). */
export function setAuthStorageMode(mode: AuthStorageMode): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(AUTH_STORAGE_MODE_KEY, mode)
}

function getAuthStorageMode(): AuthStorageMode {
  if (typeof window === 'undefined') return 'local'
  const m = localStorage.getItem(AUTH_STORAGE_MODE_KEY)
  return m === 'session' ? 'session' : 'local'
}

/** Same key pattern as @supabase/supabase-js (`sb-<project-ref>-auth-token`). */
export function supabaseAuthStorageKey(): string {
  const host = new URL(SUPABASE_URL).hostname.split('.')[0]
  return `sb-${host}-auth-token`
}

/**
 * Synchronous read of persisted session blob — matches where `sb` stores auth.
 * Used so the first paint can use the same chrome as the post-login app (bottom nav)
 * while `getSession()` is still resolving (removes a common iOS PWA “flash”).
 */
export function peekPersistedAuthPresent(): boolean {
  if (typeof window === 'undefined') return false
  const key = supabaseAuthStorageKey()
  const looksLikeSession = (raw: string | null): boolean => {
    if (!raw) return false
    try {
      const v = JSON.parse(raw) as unknown
      if (!v || typeof v !== 'object') return false
      const o = v as Record<string, unknown>
      return typeof o.access_token === 'string' || typeof o.refresh_token === 'string'
    } catch {
      return false
    }
  }
  const mode = getAuthStorageMode()
  if (mode === 'session') {
    return looksLikeSession(sessionStorage.getItem(key))
  }
  return looksLikeSession(localStorage.getItem(key)) || looksLikeSession(sessionStorage.getItem(key))
}

/** Supabase auth persistence: mirrors default behaviour with a switchable backing store. */
const authStorageAdapter: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
  getItem(key: string): string | null {
    if (typeof window === 'undefined') return null
    const mode = getAuthStorageMode()
    if (mode === 'session') {
      return sessionStorage.getItem(key)
    }
    return localStorage.getItem(key) ?? sessionStorage.getItem(key)
  },
  setItem(key: string, value: string): void {
    if (typeof window === 'undefined') return
    const mode = getAuthStorageMode()
    if (mode === 'session') {
      sessionStorage.setItem(key, value)
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
      sessionStorage.removeItem(key)
    }
  },
  removeItem(key: string): void {
    if (typeof window === 'undefined') return
    localStorage.removeItem(key)
    sessionStorage.removeItem(key)
  },
}

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: authStorageAdapter as Storage,
    persistSession: true,
    autoRefreshToken: true,
  },
})

/** Must match `delete-account` Edge Function and user prompt (permanent account deletion). */
export const DELETE_ACCOUNT_CONFIRM = 'DELETE MY ACCOUNT' as const

export async function deleteMyAccount(confirm: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (confirm !== DELETE_ACCOUNT_CONFIRM) {
    return { ok: false, error: `Confirmation must be exactly: ${DELETE_ACCOUNT_CONFIRM}` }
  }
  const { data: userData, error: userErr } = await sb.auth.getUser()
  if (userErr || !userData.user) {
    return { ok: false, error: 'Session expired. Please log out and log in again, then retry.' }
  }

  const getToken = async (): Promise<string> => {
    let { data: sessionData } = await sb.auth.getSession()
    if (!sessionData.session?.access_token) {
      const { data: refreshed } = await sb.auth.refreshSession()
      sessionData = refreshed
    }
    return sessionData.session?.access_token || ''
  }

  const runInvoke = async (accessToken: string) => {
    return sb.functions.invoke<{ ok?: boolean; error?: string }>('delete-account', {
      body: { confirm: DELETE_ACCOUNT_CONFIRM },
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: SUPABASE_ANON_KEY,
      },
    })
  }

  let token = await getToken()
  if (!token) return { ok: false, error: 'Session expired. Please log out and log in again, then retry.' }

  let result = await runInvoke(token)
  if (result.error) {
    // iOS/PWA can hold stale token on resume; refresh and retry once.
    await sb.auth.refreshSession()
    token = await getToken()
    if (!token) return { ok: false, error: 'Session expired. Please log out and log in again, then retry.' }
    result = await runInvoke(token)
  }

  if (result.error) {
    let msg = result.error.message || ''
    const errWithContext = result.error as unknown as { context?: unknown }
    const ctx = errWithContext.context
    if (ctx instanceof Response) {
      const status = ctx.status
      let bodyMsg = ''
      try {
        const parsed = (await ctx.clone().json()) as { error?: string; message?: string }
        bodyMsg = parsed.error || parsed.message || ''
      } catch {
        bodyMsg = (await ctx.clone().text().catch(() => '')) || ''
      }
      msg = [msg, bodyMsg].filter(Boolean).join(' — ') || `Delete failed (${status})`
      if (status === 401) {
        return { ok: false, error: 'Session expired. Please log out and log in again, then retry.' }
      }
    }
    if (msg.toLowerCase().includes('401') || msg.toLowerCase().includes('unauthorized')) {
      return { ok: false, error: 'Session expired. Please log out and log in again, then retry.' }
    }
    return { ok: false, error: msg || 'Delete account failed' }
  }

  const payload = result.data
  if (payload && typeof payload.error === 'string' && payload.error) {
    return { ok: false, error: payload.error }
  }
  return { ok: true }
}

/** Prefix in chat messages used to signal an incoming Random video call invite. */
export const RANDOM_CALL_INVITE_MARKER = '[RANDOM_CALL_INVITE]'

/** Prefix for 1:1 Chat video call invites (same detection pattern as Random). */
export const CHAT_CALL_INVITE_MARKER = '[CHAT_CALL_INVITE]'

export function randomCallInviteMessageRinging(callerName: string): string {
  return `${RANDOM_CALL_INVITE_MARKER} ${callerName} is calling you in Random.`
}

export function randomCallInviteMessageMissed(callerName: string): string {
  return `${RANDOM_CALL_INVITE_MARKER} Missed call from ${callerName}`
}

export function chatCallInviteMessageRinging(callerName: string): string {
  return `${CHAT_CALL_INVITE_MARKER} ${callerName} is calling you in Chat.`
}

export function chatCallInviteMessageMissed(callerName: string): string {
  return `${CHAT_CALL_INVITE_MARKER} Missed call from ${callerName}`
}

/** Hide internal marker in chat UI; stored text still includes it for detection. */
export function displayChatMessageText(text: string | null | undefined): string {
  const raw = typeof text === 'string' ? text : text == null ? '' : String(text)
  const t = raw.trim()
  if (t.startsWith(CHAT_CALL_INVITE_MARKER)) {
    const rest = t.slice(CHAT_CALL_INVITE_MARKER.length).trim()
    return rest || t
  }
  if (t.startsWith(RANDOM_CALL_INVITE_MARKER)) {
    const rest = t.slice(RANDOM_CALL_INVITE_MARKER.length).trim()
    return rest || t
  }
  if (t.startsWith('[CONF_SESSION_INVITE]:')) {
    const rest = t.replace(/^\[CONF_SESSION_INVITE\]:[^\s]+\s+/, '')
    return rest.trim() || t
  }
  if (t.startsWith('[CONF_MISSED:') || t.startsWith('[CONF_REMINDER:')) {
    const rest = t.replace(/^\[CONF_(?:MISSED|REMINDER):[^\]]+\]\s*/, '')
    return rest.trim() || t
  }
  return t
}

/** After decline or end without connecting, rewrite the latest invite line to "Missed call from …". */
export async function markLatestRandomCallInviteAsMissed(bizA: string, bizB: string): Promise<void> {
  const { data: chatId } = await sb.rpc('get_or_create_chat', { biz_a: bizA, biz_b: bizB })
  if (!chatId) return
  const { data: rows } = await sb
    .from('messages')
    .select('id,sender_id,text')
    .eq('chat_id', chatId)
    .ilike('text', `%${RANDOM_CALL_INVITE_MARKER}%`)
    .order('created_at', { ascending: false })
    .limit(1)
  const row = rows?.[0]
  if (!row?.text) return
  if (!row.text.includes('is calling you')) return
  const { data: caller } = await sb.from('businesses').select('name').eq('id', row.sender_id).single()
  const name = (caller?.name || 'Someone').trim() || 'Someone'
  await sb.from('messages').update({ text: randomCallInviteMessageMissed(name) }).eq('id', row.id)
}

export type MarkMissedResult = { ok: true } | { ok: false; error: string }

/** Rewrite latest ringing Chat call invite to missed (caller ended before connect). */
export async function markLatestChatCallInviteAsMissed(bizA: string, bizB: string): Promise<MarkMissedResult> {
  const { data: chatId, error: rpcErr } = await sb.rpc('get_or_create_chat', { biz_a: bizA, biz_b: bizB })
  if (rpcErr || !chatId) {
    return { ok: false, error: rpcErr?.message || 'Could not open chat' }
  }
  const { data: rows, error: selErr } = await sb
    .from('messages')
    .select('id,sender_id,text')
    .eq('chat_id', chatId)
    .ilike('text', `%${CHAT_CALL_INVITE_MARKER}%`)
    .order('created_at', { ascending: false })
    .limit(1)
  if (selErr) return { ok: false, error: selErr.message }
  const row = rows?.[0]
  if (!row?.text) return { ok: false, error: 'No call invite line found' }
  if (!row.text.includes('is calling you')) return { ok: false, error: 'Latest invite is not ringing' }
  const { data: caller } = await sb.from('businesses').select('name').eq('id', row.sender_id).single()
  const name = (caller?.name || 'Someone').trim() || 'Someone'
  const { data: updated, error: updErr } = await sb
    .from('messages')
    .update({ text: chatCallInviteMessageMissed(name) })
    .eq('id', row.id)
    .select('id')
  if (updErr) return { ok: false, error: updErr.message }
  if (!updated?.length) {
    return { ok: false, error: 'Could not update invite (check permissions)' }
  }
  return { ok: true }
}

let lastUploadError = ''

export function getLastUploadError() {
  return lastUploadError
}

export async function uploadImage(file: File, folder: string): Promise<string | null> {
  lastUploadError = ''
  const { data: authData } = await sb.auth.getUser()
  const userId = authData.user?.id
  const extFromName = file.name.includes('.') ? file.name.split('.').pop() : ''
  const extFromMime = file.type?.split('/')?.[1] || 'jpg'
  const ext = (extFromName || extFromMime || 'jpg').toLowerCase()
  const safeFolder = folder.replace(/[^a-zA-Z0-9/_-]/g, '') || 'uploads'
  const keyPrefix = userId ? (userId + '/') : ''
  const filename = keyPrefix + safeFolder + '/' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.' + ext
  const { error } = await sb.storage.from('bizzkit-images').upload(filename, file, {
    cacheControl: '3600',
    contentType: file.type || undefined,
    upsert: false
  })
  if (error) {
    lastUploadError = error.message || 'Storage upload failed'
    console.error('Upload error:', error)
    return null
  }
  const { data: pub } = sb.storage.from('bizzkit-images').getPublicUrl(filename)
  const publicUrl = pub.publicUrl

  // Works for both public and private buckets.
  const { data: signed, error: signedErr } = await sb.storage.from('bizzkit-images').createSignedUrl(filename, 60 * 60 * 24 * 30)
  if (!signedErr && signed?.signedUrl) return signed.signedUrl
  return publicUrl
}

export type Business = {
  id: string; owner_id: string; name: string; tagline: string
  description: string; industry: string; type: string
  city: string; country: string; website: string
  founded: string; logo: string; logo_url?: string; grad: string
  kyc_verified: boolean; certified: boolean
  trust_score: number; trust_tier: string; followers: number
  created_at: string; updated_at: string
  /** Set when peer row was not loaded yet — ChatView should fetch by id */
  _peer_placeholder?: boolean
  /** Reserved for future use; not used while session alerts are email-only */
  phone_whatsapp?: string | null
  notify_session_invite_email?: boolean
  notify_session_invite_whatsapp?: boolean
  /** When true, session start reminders are also sent by email (in addition to chat) */
  notify_session_calendar_reminders?: boolean
  products?: Product[]
}

export type Product = {
  id: string; business_id: string; name: string
  price: string; emoji: string; category: string
}

const BUSINESS_IN_CHUNK = 100

/** Postgres UUIDs compare case-insensitively; JS string keys do not — normalize for Maps/Sets. */
export function normalizeUuid(id: string | null | undefined): string {
  if (id == null || id === '') return ''
  return String(id).trim().toLowerCase()
}

/** The other business id in a 1:1 chat row (participant order + UUID casing vary). */
export function otherChatParticipantId(
  chat: { participant_a: string; participant_b: string },
  myBizId: string,
): string {
  const a = normalizeUuid(chat.participant_a)
  const b = normalizeUuid(chat.participant_b)
  const m = normalizeUuid(myBizId)
  if (a === m) return chat.participant_b
  if (b === m) return chat.participant_a
  return chat.participant_b
}

/** The other business id in a connections row (direction + UUID casing vary). */
export function otherConnectionBusinessId(
  row: { from_biz_id: string; to_biz_id: string },
  myBizId: string,
): string | null {
  const f = normalizeUuid(row.from_biz_id)
  const t = normalizeUuid(row.to_biz_id)
  const m = normalizeUuid(myBizId)
  if (f === m) return row.to_biz_id
  if (t === m) return row.from_biz_id
  return null
}

/** Remove the single connection row between two businesses (either insert direction). */
export async function deleteConnectionBetween(
  businessIdA: string,
  businessIdB: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const nb = normalizeUuid(businessIdB)
  const { data: rows, error: selErr } = await sb
    .from('connections')
    .select('id,from_biz_id,to_biz_id')
    .or(`from_biz_id.eq.${businessIdA},to_biz_id.eq.${businessIdA}`)
  if (selErr) return { ok: false, error: selErr.message }
  const row = (rows || []).find((r: { id: string; from_biz_id: string; to_biz_id: string }) => {
    const other = otherConnectionBusinessId(r, businessIdA)
    return other != null && normalizeUuid(other) === nb
  })
  if (!row) return { ok: false, error: 'Connection not found.' }
  const { error: delErr } = await sb.from('connections').delete().eq('id', row.id)
  if (delErr) return { ok: false, error: delErr.message }
  return { ok: true }
}

/**
 * Load `businesses` rows by id (chunked). Uses SECURITY DEFINER RPC when deployed so peer names
 * are not blocked by RLS; falls back to PostgREST `.in()` + per-id reads.
 */
export async function fetchBusinessProfilesByIds(select: string, ids: string[]): Promise<Business[]> {
  const unique = [...new Set(ids.filter(Boolean).map((id) => normalizeUuid(id)).filter(Boolean))]
  if (!unique.length) return []
  const byId = new Map<string, Business>()
  const needProducts = select.includes('products(')

  for (let i = 0; i < unique.length; i += BUSINESS_IN_CHUNK) {
    const chunk = unique.slice(i, i + BUSINESS_IN_CHUNK)
    const { data: rpcRows, error: rpcErr } = await sb.rpc('get_business_profiles_by_ids', { p_ids: chunk })
    if (!rpcErr && Array.isArray(rpcRows) && rpcRows.length) {
      for (const row of rpcRows as Business[]) {
        if (row?.id) byId.set(normalizeUuid(row.id), row)
      }
    } else if (rpcErr) {
      console.warn('get_business_profiles_by_ids RPC:', rpcErr.message)
    }
    const stillMissing = chunk.filter((id) => !byId.has(id))
    if (!stillMissing.length) continue
    const { data: directRows, error: dErr } = await sb.from('businesses').select(select).in('id', stillMissing)
    if (dErr) {
      console.warn('fetchBusinessProfilesByIds direct batch:', dErr.message)
    } else if (directRows) {
      for (const row of directRows as Business[]) {
        if (row?.id) byId.set(normalizeUuid(row.id), row)
      }
    }
    const stillMissing2 = stillMissing.filter((id) => !byId.has(id))
    for (const id of stillMissing2) {
      const { data: one } = await sb.from('businesses').select(select).eq('id', id).maybeSingle()
      if (one?.id) byId.set(normalizeUuid(one.id), one as Business)
    }
  }

  if (needProducts) {
    const needAttach = [...byId.keys()].filter((nid) => !byId.get(nid)?.products?.length)
    if (needAttach.length) {
      const { data: prods, error: pe } = await sb
        .from('products')
        .select('id,business_id,name,emoji,price,category')
        .in('business_id', needAttach)
      if (pe) {
        console.warn('fetchBusinessProfilesByIds products:', pe.message)
      } else if (prods?.length) {
        const byBus = new Map<string, Product[]>()
        for (const p of prods as Product[]) {
          const bid = normalizeUuid(p.business_id)
          if (!byBus.has(bid)) byBus.set(bid, [])
          byBus.get(bid)!.push(p)
        }
        for (const nid of needAttach) {
          const b = byId.get(nid)
          const pr = byBus.get(nid)
          if (b && pr?.length) b.products = pr
        }
      }
    }
  }

  return unique.map((id) => byId.get(id)).filter((b): b is Business => !!b)
}

/** One business by id — RPC first (RLS-safe), then direct select. */
export async function fetchBusinessByIdRobust(id: string): Promise<Business | null> {
  const n = normalizeUuid(id)
  if (!n) return null
  const { data: rpcRows, error: rpcErr } = await sb.rpc('get_business_profiles_by_ids', { p_ids: [n] })
  if (!rpcErr && Array.isArray(rpcRows) && rpcRows[0]) return rpcRows[0] as Business
  if (rpcErr) console.warn('get_business_profiles_by_ids RPC (single):', rpcErr.message)
  const { data: one } = await sb.from('businesses').select('*').eq('id', id).maybeSingle()
  return (one as Business | null) ?? null
}

export type Conference = {
  id: string; organizer_id: string; title: string
  date: string; time: string; industry: string; location: string
  max_attendees: number; status: string; created_at: string
  conference_attendees?: { business_id: string }[]
}

/** Prefix for Connect → conference session invites sent via DM (dedupe by id in message). */
export const CONFERENCE_SESSION_INVITE_MARKER = '[CONF_SESSION_INVITE]'

export function conferenceSessionInviteMessage(inviterName: string, conf: Conference): string {
  const head = `${CONFERENCE_SESSION_INVITE_MARKER}:${conf.id}`
  return `${head} ${inviterName} invited you to join "${conf.title}" on ${fmtDate(conf.date)} at ${conf.time}. Accept or Decline below.`
}

export type SessionExternalNotifyKind = 'invite' | 'reminder'

/** Triggers session emails (per recipient profile settings) via Edge Function `session-external-notify`. */
export async function notifySessionExternal(
  conferenceId: string,
  recipientBusinessId: string,
  senderBusinessId: string,
  kind: SessionExternalNotifyKind,
): Promise<void> {
  try {
    const { data: { session } } = await sb.auth.getSession()
    if (!session?.access_token) return
    const res = await fetch(`${SUPABASE_URL}/functions/v1/session-external-notify`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conferenceId,
        recipientBusinessId,
        senderBusinessId,
        kind,
      }),
    })
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      console.warn('session-external-notify', res.status, j?.error ?? res.statusText)
    }
  } catch (e) {
    console.warn('notifySessionExternal', e)
  }
}

export type Chat = {
  id: string; participant_a: string; participant_b: string; created_at: string
  other_biz?: Business; last_msg?: string; last_ts?: string; unread?: number
}

export type Msg = {
  id: string; chat_id: string; sender_id: string
  text: string; read: boolean; created_at: string
}

export const INDUSTRIES = ['Technology','Food & Beverage','Fashion','Energy','Agriculture','Healthcare','Manufacturing','Finance','Construction','Retail','Other']
export const COUNTRIES  = ['UAE','UK','USA','Saudi Arabia','Turkey','Nigeria','India','Germany','France','China','Egypt','Jordan','Pakistan','Other']
export const TIMES      = ['9:00 AM','10:00 AM','12:00 PM','2:00 PM','5:00 PM','7:00 PM']
export const EMOJIS     = ['📦','🛍️','💊','🍔','👕','⚡','🔧','💻','🏥','🌱','🤖','🔒','☁️','📊','🔗','🏭','🎯','💎']

export function grad(id: string | undefined | null) {
  const s = id ?? ''
  const g = ['gr1','gr2','gr3','gr4','gr5','gr6','gr7','gr8']
  let h = 0
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0 }
  return g[Math.abs(h) % g.length]
}

export function getLogo(name: string) {
  return name.split(' ').slice(0,2).map(w => w[0] || '').join('').toUpperCase() || 'BK'
}

export function tier(score: number) {
  return score >= 90 ? 'Platinum' : score >= 75 ? 'Gold' : score >= 50 ? 'Silver' : 'Bronze'
}

export function tierIcon(t: string) {
  return ({Bronze:'🥉',Silver:'🥈',Gold:'🥇',Platinum:'💎'} as any)[t] || '🥉'
}

export function tierColor(t: string) {
  return ({Bronze:'#CD7C2F',Silver:'#9CA3AF',Gold:'#F5A623',Platinum:'#1E7EF7'} as any)[t] || '#7A92B0'
}

export function indEmoji(i: string) {
  return ({'Technology':'💻','Food & Beverage':'🍔','Fashion':'👕','Energy':'⚡','Agriculture':'🌾','Healthcare':'💊','Manufacturing':'🏭','Finance':'💰','Construction':'🏗️','Retail':'🛍️'} as any)[i] || '🏢'
}

export function fmtTime(ts: string) {
  return new Date(ts).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' })
}

export function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
}

export function timeAgo(ts: string) {
  const d = Date.now() - new Date(ts).getTime()
  if (d < 60000) return 'now'
  if (d < 3600000) return Math.floor(d/60000) + 'm'
  if (d < 86400000) return Math.floor(d/3600000) + 'h'
  return new Date(ts).toLocaleDateString('en-GB', { day:'numeric', month:'short' })
}
