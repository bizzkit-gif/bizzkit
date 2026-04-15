import { useEffect, useMemo, useState } from 'react'
import { sb } from './db'

type PresenceMap = Record<string, boolean>

/**
 * Track whether watched business ids are online via Supabase Realtime Presence.
 * Online means the business currently has at least one active tracked client.
 */
export function useBusinessOnlineMap(myBusinessId: string | null | undefined, watchBusinessIds: string[]): PresenceMap {
  const watchIds = useMemo(
    () => Array.from(new Set(watchBusinessIds.map((id) => id.trim()).filter(Boolean))).sort(),
    [watchBusinessIds]
  )
  const [onlineById, setOnlineById] = useState<PresenceMap>({})

  useEffect(() => {
    setOnlineById((prev) => {
      const next: PresenceMap = {}
      for (const id of watchIds) next[id] = prev[id] || false
      return next
    })
  }, [watchIds])

  useEffect(() => {
    if (!myBusinessId) return
    const channel = sb.channel('presence-business-online')

    const recompute = () => {
      const state = channel.presenceState() as Record<string, Array<{ bizId?: string }>>
      const online = new Set<string>()
      for (const metas of Object.values(state)) {
        for (const m of metas || []) {
          const id = (m?.bizId || '').trim()
          if (id) online.add(id)
        }
      }
      setOnlineById(() => {
        const next: PresenceMap = {}
        for (const id of watchIds) next[id] = online.has(id)
        return next
      })
    }

    channel
      .on('presence', { event: 'sync' }, recompute)
      .on('presence', { event: 'join' }, recompute)
      .on('presence', { event: 'leave' }, recompute)
      .subscribe((status: string) => {
        if (status !== 'SUBSCRIBED') return
        void channel.track({ bizId: myBusinessId, onlineAt: new Date().toISOString() })
        recompute()
      })

    return () => {
      sb.removeChannel(channel)
    }
  }, [myBusinessId, watchIds])

  return onlineById
}
