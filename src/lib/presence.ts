import { useEffect, useMemo, useRef, useState } from 'react'
import { sb } from './db'

type PresenceMap = Record<string, boolean>

/**
 * Track whether watched business ids are online via Supabase Realtime Presence.
 * Online means the business currently has at least one active tracked client.
 *
 * Subscribes once per `myBusinessId` (not on every watch-list change) so the channel
 * is not torn down when the inbox list updates — that was breaking presence indicators.
 */
export function useBusinessOnlineMap(myBusinessId: string | null | undefined, watchBusinessIds: string[]): PresenceMap {
  const watchIds = useMemo(
    () => Array.from(new Set(watchBusinessIds.map((id) => id.trim()).filter(Boolean))).sort(),
    [watchBusinessIds]
  )
  const watchIdsKey = useMemo(() => watchIds.join('\u0001'), [watchIds])

  const [onlineById, setOnlineById] = useState<PresenceMap>({})

  const watchIdsRef = useRef(watchIds)
  watchIdsRef.current = watchIds

  const recomputeRef = useRef<() => void>(() => {})

  useEffect(() => {
    setOnlineById((prev) => {
      const next: PresenceMap = {}
      for (const id of watchIds) next[id] = prev[id] ?? false
      return next
    })
  }, [watchIds])

  useEffect(() => {
    if (!myBusinessId) return

    const channel = sb.channel('presence-business-online')

    const recompute = () => {
      const state = channel.presenceState() as Record<string, Array<Record<string, unknown>>>
      const online = new Set<string>()
      for (const metas of Object.values(state)) {
        for (const raw of metas || []) {
          const id = String(raw.bizId ?? '').trim()
          if (id) online.add(id)
        }
      }
      const watch = watchIdsRef.current
      setOnlineById(() => {
        const next: PresenceMap = {}
        for (const id of watch) next[id] = online.has(id)
        return next
      })
    }

    recomputeRef.current = recompute

    channel
      .on('presence', { event: 'sync' }, recompute)
      .on('presence', { event: 'join' }, recompute)
      .on('presence', { event: 'leave' }, recompute)
      .subscribe((status: string) => {
        if (status !== 'SUBSCRIBED') return
        void channel
          .track({ bizId: myBusinessId, onlineAt: new Date().toISOString() })
          .then(() => recompute())
          .catch(() => recompute())
      })

    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      void channel
        .track({ bizId: myBusinessId, onlineAt: new Date().toISOString() })
        .then(() => recompute())
        .catch(() => recompute())
    }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      recomputeRef.current = () => {}
      document.removeEventListener('visibilitychange', onVis)
      sb.removeChannel(channel)
    }
  }, [myBusinessId])

  useEffect(() => {
    recomputeRef.current()
  }, [watchIdsKey])

  return onlineById
}
