import { useCallback, useEffect, useState } from 'react'
import {
  getNotificationSettings,
  setNotificationSettings,
  type NotificationSettings,
} from '../lib/notificationSettings'

export function useNotificationSettings(): [NotificationSettings, (u: Partial<NotificationSettings>) => void] {
  const [settings, setSettings] = useState(() => getNotificationSettings())

  useEffect(() => {
    const sync = () => setSettings(getNotificationSettings())
    window.addEventListener('bizzkit-notification-settings', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('bizzkit-notification-settings', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const update = useCallback((partial: Partial<NotificationSettings>) => {
    setNotificationSettings(partial)
    setSettings(getNotificationSettings())
  }, [])

  return [settings, update]
}
