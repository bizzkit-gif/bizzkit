import { createClient } from '@supabase/supabase-js'

// Keys hardcoded - no .env file needed
const SUPABASE_URL = 'https://ganberetmowmaidioryu.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdhbmJlcmV0bW93bWFpZGlvcnl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4OTg5MzksImV4cCI6MjA4OTQ3NDkzOX0.5-mD0cFberNXOmSh8F0lItV6wbTJE0zHjCiPFAYfExE'

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

export async function uploadImage(file: File, folder: string): Promise<string | null> {
  const ext = file.name.split('.').pop()
  const filename = folder + '/' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.' + ext
  const { error } = await sb.storage.from('bizzkit-images').upload(filename, file, { cacheControl: '3600', upsert: true })
  if (error) { console.error('Upload error:', error); return null }
  const { data } = sb.storage.from('bizzkit-images').getPublicUrl(filename)
  return data.publicUrl
}

export type Business = {
  id: string; owner_id: string; name: string; tagline: string
  description: string; industry: string; type: string
  city: string; country: string; website: string
  founded: string; logo: string; grad: string
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
