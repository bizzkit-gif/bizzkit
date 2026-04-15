import { createClient } from '@supabase/supabase-js'

// Keys hardcoded - no .env file needed
const SUPABASE_URL = 'https://ganberetmowmaidioryu.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdhbmJlcmV0bW93bWFpZGlvcnl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4OTg5MzksImV4cCI6MjA4OTQ3NDkzOX0.5-mD0cFberNXOmSh8F0lItV6wbTJE0zHjCiPFAYfExE'

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

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
  const t = (text || '').trim()
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
  products?: Product[]
}

export type Product = {
  id: string; business_id: string; name: string
  price: string; emoji: string; category: string
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
  return `${head} ${inviterName} invited you to join "${conf.title}" on ${fmtDate(conf.date)} at ${conf.time}. Open Connect → Conferences to find and join this session.`
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

export function grad(id: string) {
  const g = ['gr1','gr2','gr3','gr4','gr5','gr6','gr7','gr8']
  let h = 0
  for (let i = 0; i < id.length; i++) { h = ((h << 5) - h) + id.charCodeAt(i); h |= 0 }
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
