export type NotificationSettings = {
  /** In-app beeps for new messages and missed-call alerts */
  soundMessages: boolean
  /** In-app ring tones for incoming Chat / Random calls */
  soundCalls: boolean
  /** Device vibration patterns where supported */
  haptics: boolean
  /** System notification banners when the tab is in the background (requires browser permission) */
  backgroundBanners: boolean
  /** Register this device for remote push when the app is closed (requires permission + VAPID) */
  pushRemote: boolean
}

const STORAGE_KEY = 'bizzkit.notificationSettings.v1'

const DEFAULTS: NotificationSettings = {
  soundMessages: true,
  soundCalls: true,
  haptics: true,
  backgroundBanners: true,
  pushRemote: true,
}

function parseStored(raw: string | null): NotificationSettings {
  if (!raw) return { ...DEFAULTS }
  try {
    const o = JSON.parse(raw) as unknown
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { ...DEFAULTS }
    const rec = o as Record<string, unknown>
    const next: NotificationSettings = { ...DEFAULTS }
    ;(Object.keys(DEFAULTS) as (keyof NotificationSettings)[]).forEach((k) => {
      if (typeof rec[k] === 'boolean') next[k] = rec[k] as boolean
    })
    return next
  } catch {
    return { ...DEFAULTS }
  }
}

export function getNotificationSettings(): NotificationSettings {
  if (typeof window === 'undefined') return { ...DEFAULTS }
  return parseStored(localStorage.getItem(STORAGE_KEY))
}

export function setNotificationSettings(partial: Partial<NotificationSettings>): void {
  const next = { ...getNotificationSettings(), ...partial }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* quota */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('bizzkit-notification-settings'))
  }
}

export function shouldPlayTone(kind: 'message' | 'call' | 'alert'): boolean {
  const s = getNotificationSettings()
  if (kind === 'call') return s.soundCalls
  return s.soundMessages
}

export function shouldVibrate(): boolean {
  return getNotificationSettings().haptics
}

export function shouldShowBackgroundBanner(): boolean {
  return getNotificationSettings().backgroundBanners
}

export function shouldRegisterRemotePush(): boolean {
  return getNotificationSettings().pushRemote
}

export function vibrateIfEnabled(pattern: number | number[]): void {
  if (!shouldVibrate() || typeof navigator === 'undefined' || !navigator.vibrate) return
  navigator.vibrate(pattern)
}
