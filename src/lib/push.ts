import { sb } from './db'
import { getNotificationSettings } from './notificationSettings'

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(safe)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    const reg = await navigator.serviceWorker.register('/sw.js')
    return reg
  } catch {
    return null
  }
}

export async function ensurePushSubscription(businessId: string): Promise<void> {
  if (!businessId) return
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return
  const vapidPublic = (import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY as string | undefined)?.trim()
  if (!vapidPublic) return

  const reg = (await navigator.serviceWorker.getRegistration()) || (await registerServiceWorker())
  if (!reg) return
  await navigator.serviceWorker.ready

  if (!getNotificationSettings().pushRemote) {
    try {
      const existing = await reg.pushManager.getSubscription()
      if (existing) await existing.unsubscribe()
    } catch {
      /* ignore */
    }
    return
  }

  let permission = Notification.permission
  if (permission === 'default') {
    permission = await Notification.requestPermission()
  }
  if (permission !== 'granted') return

  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublic) as BufferSource,
    })
  }
  const payload = sub.toJSON()
  if (!payload.endpoint || !payload.keys?.auth || !payload.keys?.p256dh) return
  await sb.functions.invoke('register-push-subscription', {
    body: {
      businessId,
      subscription: {
        endpoint: payload.endpoint,
        auth: payload.keys.auth,
        p256dh: payload.keys.p256dh,
      },
      userAgent: navigator.userAgent || '',
    },
  })
}

type PushSendInput = {
  recipientBusinessId: string
  senderBusinessId: string
  title: string
  body: string
  tag?: string
  url?: string
}

export async function sendPushNotification(input: PushSendInput): Promise<void> {
  if (!input.recipientBusinessId || !input.senderBusinessId) return
  await sb.functions.invoke('send-push-notification', { body: input })
}

