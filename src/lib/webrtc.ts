/**
 * Whether this peer should send the WebRTC offer (vs answer).
 * Must be identical for both sides — do NOT use String.localeCompare (depends on user locale).
 */
export function iAmWebRtcOfferer(myBusinessId: string, otherBusinessId: string): boolean {
  const a = myBusinessId.trim().toLowerCase()
  const b = otherBusinessId.trim().toLowerCase()
  return a < b
}

/** Safe Realtime topic: letters, digits, underscore, hyphen only; max length for Supabase. */
export function sanitizeRealtimeChannelId(raw: string, maxLen = 200): string {
  const s = raw.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-')
  return s.length <= maxLen ? s : s.slice(0, maxLen)
}
