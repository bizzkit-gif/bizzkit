import { shouldPlayTone, shouldShowBackgroundBanner } from './notificationSettings'

type ToneKind = 'message' | 'call' | 'alert'

let audioCtx: AudioContext | null = null
let originalTitle = ''

function getAudioContext(): AudioContext | null {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return null
  if (!audioCtx) audioCtx = new Ctx()
  return audioCtx
}

/**
 * Browsers (especially iOS Safari) start AudioContext suspended until a user gesture.
 * Call this once after tap/click so message/call tones can play later.
 */
export function primeNotificationAudio(): void {
  const ctx = getAudioContext()
  if (!ctx) return
  void ctx.resume().catch(() => {})
}

async function ensureAudioRunning(): Promise<AudioContext | null> {
  const ctx = getAudioContext()
  if (!ctx || ctx.state === 'closed') return null
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume()
    } catch {
      /* ignore — may need user gesture first */
    }
  }
  return ctx
}

function tone(ctx: AudioContext, freq: number, duration = 0.08, delay = 0, peak = 0.1): void {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  gain.gain.value = 0.0001
  osc.connect(gain)
  gain.connect(ctx.destination)
  const t0 = ctx.currentTime + delay
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
  osc.start(t0)
  osc.stop(t0 + duration + 0.01)
}

async function playTones(kind: ToneKind): Promise<void> {
  const ctx = await ensureAudioRunning()
  if (!ctx || ctx.state === 'closed') return
  if (kind === 'message') {
    tone(ctx, 880, 0.06, 0, 0.1)
    tone(ctx, 1175, 0.08, 0.08, 0.1)
    return
  }
  if (kind === 'alert') {
    tone(ctx, 740, 0.08, 0, 0.1)
    tone(ctx, 587, 0.1, 0.12, 0.1)
    return
  }
  // call ring — slightly louder triple beep
  tone(ctx, 1046, 0.1, 0, 0.12)
  tone(ctx, 1318, 0.12, 0.14, 0.12)
  tone(ctx, 1046, 0.1, 0.32, 0.12)
}

/**
 * Plays a short in-app tone for new messages / calls. Uses Web Audio (no asset files).
 * On iOS, audio unlocks after the user has interacted with the page once (`primeNotificationAudio`).
 */
export function playNotificationTone(kind: ToneKind): void {
  if (!shouldPlayTone(kind)) return
  void playTones(kind).catch(() => {})
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
  if (!shouldShowBackgroundBanner()) return
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
