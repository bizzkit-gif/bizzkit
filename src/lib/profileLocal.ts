/** Emails we have seen with a businesses row on this device (set after successful load). */

const KEY = 'bizzkit_emails_with_profile'

function readMap(): Record<string, true> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const o = JSON.parse(raw) as unknown
    if (typeof o !== 'object' || o === null || Array.isArray(o)) return {}
    const out: Record<string, true> = {}
    for (const [k, v] of Object.entries(o)) {
      if (v === true && typeof k === 'string' && k.includes('@')) {
        out[k.trim().toLowerCase()] = true
      }
    }
    return out
  } catch {
    return {}
  }
}

function writeMap(m: Record<string, true>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(m))
  } catch {
    /* ignore quota */
  }
}

export function emailHasStoredProfile(email: string): boolean {
  const em = email.trim().toLowerCase()
  if (!em) return false
  return readMap()[em] === true
}

export function setEmailHasProfile(email: string): void {
  const em = email.trim().toLowerCase()
  if (!em) return
  const m = readMap()
  m[em] = true
  writeMap(m)
}

export function clearEmailHasProfile(email: string): void {
  const em = email.trim().toLowerCase()
  if (!em) return
  const m = readMap()
  delete m[em]
  writeMap(m)
}
