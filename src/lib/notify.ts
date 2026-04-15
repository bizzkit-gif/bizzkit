type ToneKind = 'message' | 'call' | 'alert'

let audioCtx: AudioContext | null = null
let originalTitle = ''

function getAudioContext(): AudioContext | null {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return null
  if (!audioCtx) audioCtx = new Ctx()
  return audioCtx
}

function tone(freq: number, duration = 0.08, delay = 0): void {
  const ctx = getAudioContext()
  if (!ctx) return
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  gain.gain.value = 0.0001
  osc.connect(gain)
  gain.connect(ctx.destination)
  const t0 = ctx.currentTime + delay
  gain.gain.exponentialRampToValueAtTime(0.08, t0 + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
  osc.start(t0)
  osc.stop(t0 + duration + 0.01)
}

export function playNotificationTone(kind: ToneKind): void {
  try {
    if (kind === 'message') {
      tone(880, 0.06, 0)
      tone(1175, 0.08, 0.08)
      return
    }
    if (kind === 'alert') {
      tone(740, 0.08, 0)
      tone(587, 0.1, 0.12)
      return
    }
    // call ring
    tone(1046, 0.1, 0)
    tone(1318, 0.12, 0.14)
    tone(1046, 0.1, 0.32)
  } catch {
    // no-op
  }
}

export function syncAppIconBadge(count: number): void {
  const n = Math.max(0, Math.floor(count))
  const nav = navigator as Navigator & {
    setAppBadge?: (count?: number) => Promise<void>
    clearAppBadge?: () => Promise<void>
  }
  if (n > 0) {
    void nav.setAppBadge?.(n)
  } else {
    void nav.clearAppBadge?.()
  }

  // Fallback visual cue where App Badge API is not supported.
  if (!originalTitle) originalTitle = document.title
  document.title = n > 0 ? `(${n}) ${originalTitle}` : originalTitle
}

export async function tryShowNativeNotification(title: string, body: string, tag: string): Promise<void> {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (document.visibilityState === 'visible') return
  if (Notification.permission === 'default') {
    try {
      await Notification.requestPermission()
    } catch {
      return
    }
  }
  if (Notification.permission !== 'granted') return
  try {
    new Notification(title, { body, tag, silent: false })
  } catch {
    // no-op
  }
}

