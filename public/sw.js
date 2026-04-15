self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {}
  const title = data?.title || 'Bizzkit'
  const body = data?.body || 'You have a new notification.'
  const tag = data?.tag || 'bizzkit-notification'
  const url = data?.url || '/'
  const badgeCount = Number(data?.badgeCount || 0)

  const show = async () => {
    try {
      if ('setAppBadge' in self.registration) {
        if (badgeCount > 0) {
          await self.registration.setAppBadge(badgeCount)
        } else {
          await self.registration.clearAppBadge()
        }
      }
    } catch {
      // ignore badge api failures
    }
    await self.registration.showNotification(title, {
      body,
      tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url, badgeCount },
      renotify: true,
    })
  }

  event.waitUntil(show())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification?.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.focus()
          client.postMessage({ type: 'OPEN_URL', url: targetUrl })
          return client
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl)
      return null
    })
  )
})

