import React, { useState, useEffect, useRef, useCallback } from 'react'
import { sb, Business } from '../lib/db'

type LiveSignal = {
  type: 'ready' | 'offer' | 'answer' | 'ice'
  from: string
  to?: string
  bizName?: string
  payload?: unknown
}

export type PeerVideoCallProps = {
  myBiz: Business
  other: Business
  /** Unique Supabase Realtime channel id for WebRTC signaling (no spaces). */
  signalingChannelId: string
  onEnd: () => void
  /** Called when ending before remote video connects (optional). */
  onEndWithoutRemote?: () => void | Promise<void>
  headerEmoji?: string
  subtitleLine?: string
  connectingHint?: string
}

/**
 * In-app 1:1 video using WebRTC + Supabase broadcast.
 * Uses deterministic offerer + periodic "ready" pings so the first offer is not lost
 * when the other peer joins the Realtime channel later.
 */
export function PeerVideoCall({
  myBiz,
  other,
  signalingChannelId,
  onEnd,
  onEndWithoutRemote,
  headerEmoji = '💬',
  subtitleLine,
  connectingHint,
}: PeerVideoCallProps) {
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [starting, setStarting] = useState(true)
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const [localStreamVersion, setLocalStreamVersion] = useState(0)
  const channelRef = useRef<ReturnType<typeof sb.channel> | null>(null)
  const peerRef = useRef<RTCPeerConnection | null>(null)
  const peerIdRef = useRef<string>(`peer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const remoteConnectedRef = useRef(false)
  const iAmOfferer = myBiz.id.localeCompare(other.id) < 0
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([])
  const offerSentRef = useRef(false)
  const readyIntervalRef = useRef<number | null>(null)

  const sub = subtitleLine ?? `${other.industry} · ${other.city}`
  const hint = connectingHint ?? `Connecting… waiting for ${other.name}.`

  const sendSignal = useCallback((sig: LiveSignal) => {
    const ch = channelRef.current
    if (!ch) return
    ch.send({ type: 'broadcast', event: 'signal', payload: sig })
  }, [])

  const flushPendingIce = useCallback(async (pc: RTCPeerConnection) => {
    const q = pendingIceRef.current
    pendingIceRef.current = []
    for (const init of q) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(init))
      } catch {
        /* ignore invalid / expired */
      }
    }
  }, [])

  const createPeer = useCallback(() => {
    if (peerRef.current) return peerRef.current
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    })
    const local = localStreamRef.current
    if (local) local.getTracks().forEach((track) => pc.addTrack(track, local))
    pc.ontrack = (e) => {
      // Safari / some WebKit builds omit e.streams[0] even when the track is valid — build a stream from the track.
      const incoming = e.streams[0] ?? new MediaStream([e.track])
      setRemoteStream((prev) => {
        if (!prev) {
          remoteConnectedRef.current = true
          return incoming
        }
        const next = new MediaStream()
        const seen = new Set<string>()
        for (const t of [...prev.getTracks(), ...incoming.getTracks()]) {
          if (!seen.has(t.id)) {
            seen.add(t.id)
            next.addTrack(t)
          }
        }
        remoteConnectedRef.current = true
        return next
      })
    }
    pc.onicecandidate = (e) => {
      if (e.candidate) sendSignal({ type: 'ice', from: peerIdRef.current, to: '*', payload: e.candidate.toJSON(), bizName: myBiz.name })
    }
    peerRef.current = pc
    return pc
  }, [myBiz.name, sendSignal])

  const stopReadyPing = useCallback(() => {
    if (readyIntervalRef.current !== null) {
      window.clearInterval(readyIntervalRef.current)
      readyIntervalRef.current = null
    }
  }, [])

  useEffect(() => {
    let mounted = true
    const setup = async () => {
      try {
        const local = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'user' } })
        if (!mounted) {
          local.getTracks().forEach((t) => t.stop())
          return
        }
        localStreamRef.current = local
        setLocalStreamVersion((v) => v + 1)

        const ch = sb
          .channel(signalingChannelId)
          .on('broadcast', { event: 'signal' }, async ({ payload }: { payload: LiveSignal }) => {
            const msg = payload
            if (!msg || msg.from === peerIdRef.current) return

            if (msg.type === 'ready') {
              if (!iAmOfferer || offerSentRef.current) return
              void (async () => {
                try {
                  const pc = createPeer()
                  const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
                  await pc.setLocalDescription(offer)
                  offerSentRef.current = true
                  sendSignal({ type: 'offer', from: peerIdRef.current, payload: offer, bizName: myBiz.name })
                  setStarting(false)
                } catch {
                  setStarting(false)
                }
              })()
              return
            }

            if (msg.type === 'ice') {
              const init = msg.payload as RTCIceCandidateInit | undefined
              if (!init) return
              const pc = peerRef.current
              if (!pc || !pc.remoteDescription) {
                pendingIceRef.current.push(init)
                return
              }
              try {
                await pc.addIceCandidate(new RTCIceCandidate(init))
              } catch {
                pendingIceRef.current.push(init)
              }
              return
            }

            if (msg.type === 'offer') {
              if (iAmOfferer) return
              const pc = createPeer()
              await pc.setRemoteDescription(new RTCSessionDescription(msg.payload as RTCSessionDescriptionInit))
              await flushPendingIce(pc)
              const answer = await pc.createAnswer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
              await pc.setLocalDescription(answer)
              sendSignal({ type: 'answer', from: peerIdRef.current, payload: answer, bizName: myBiz.name })
              setStarting(false)
              return
            }

            if (msg.type === 'answer') {
              if (!iAmOfferer) return
              const pc = createPeer()
              await pc.setRemoteDescription(new RTCSessionDescription(msg.payload as RTCSessionDescriptionInit))
              await flushPendingIce(pc)
            }
          })
          .subscribe((status: string) => {
            if (status === 'SUBSCRIBED') {
              offerSentRef.current = false
              pendingIceRef.current = []
              stopReadyPing()
              readyIntervalRef.current = window.setInterval(() => {
                sendSignal({ type: 'ready', from: peerIdRef.current, bizName: myBiz.name })
              }, 400)
              if (!iAmOfferer) {
                setStarting(false)
              }
            }
          })
        channelRef.current = ch
      } catch {
        setStarting(false)
      }
    }
    void setup()
    return () => {
      mounted = false
      stopReadyPing()
      const ch = channelRef.current
      if (ch) sb.removeChannel(ch)
      const pc = peerRef.current
      if (pc) pc.close()
      const local = localStreamRef.current
      if (local) local.getTracks().forEach((t) => t.stop())
      channelRef.current = null
      peerRef.current = null
      localStreamRef.current = null
      pendingIceRef.current = []
      offerSentRef.current = false
    }
  }, [createPeer, flushPendingIce, iAmOfferer, myBiz.name, signalingChannelId, sendSignal, stopReadyPing])

  /** Attach local stream after ref is mounted (fixes blank self-view on some mobile WebKit builds). */
  useEffect(() => {
    const el = localVideoRef.current
    const s = localStreamRef.current
    if (!el || !s) return
    el.srcObject = s
    void el.play().catch(() => {})
  }, [localStreamVersion])

  /** Keep remote video element in sync with MediaStream (callback refs miss some updates). */
  useEffect(() => {
    const el = remoteVideoRef.current
    if (!el) return
    el.srcObject = remoteStream
    if (remoteStream) void el.play().catch(() => {})
  }, [remoteStream])

  useEffect(() => {
    if (!remoteStream) return
    stopReadyPing()
  }, [remoteStream, stopReadyPing])

  useEffect(() => {
    if (remoteStream) remoteConnectedRef.current = true
  }, [remoteStream])

  const handleEnd = async () => {
    if (!remoteConnectedRef.current && onEndWithoutRemote) {
      await onEndWithoutRemote()
    }
    onEnd()
  }

  const toggleMic = () => {
    const local = localStreamRef.current
    if (!local) return
    const next = !micOn
    local.getAudioTracks().forEach((t) => {
      t.enabled = next
    })
    setMicOn(next)
  }
  const toggleCam = () => {
    const local = localStreamRef.current
    if (!local) return
    const next = !camOn
    local.getVideoTracks().forEach((t) => {
      t.enabled = next
    })
    setCamOn(next)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px 7px', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
        <button type="button" onClick={() => void handleEnd()} style={{ background: 'none', border: 'none', color: '#7A92B0', fontSize: 18, cursor: 'pointer', padding: '2px 4px', flexShrink: 0 }}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {headerEmoji} {other.name}
          </div>
          <div style={{ fontSize: 10, color: '#7A92B0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '6px 10px', gap: 6, overflow: 'hidden' }}>
        {starting && (
          <div style={{ fontSize: 10.5, color: '#7A92B0', flexShrink: 0, lineHeight: 1.35 }}>{hint}</div>
        )}
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateRows: '1fr 1fr', gap: 7 }}>
          <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column', background: '#152236', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, overflow: 'hidden' }}>
            <video ref={localVideoRef} autoPlay muted playsInline style={{ flex: 1, minHeight: 0, width: '100%', objectFit: 'cover', display: 'block' }} />
            <div style={{ flexShrink: 0, padding: '4px 8px', fontSize: 10, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>You ({myBiz.name})</div>
          </div>
          <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column', background: '#152236', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, overflow: 'hidden' }}>
            {remoteStream ? (
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                muted={false}
                style={{ flex: 1, minHeight: 0, width: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7A92B0', fontSize: 11, textAlign: 'center', padding: '0 8px' }}>Waiting for {other.name}…</div>
            )}
            <div style={{ flexShrink: 0, padding: '4px 8px', fontSize: 10, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{other.name}</div>
          </div>
        </div>
      </div>
      <div style={{ flexShrink: 0, padding: '8px 10px calc(8px + env(safe-area-inset-bottom,0px))', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', gap: 6 }}>
        <button type="button" className="btn btn-ghost" style={{ flex: 1, padding: '8px 6px', fontSize: 11 }} onClick={toggleMic}>
          {micOn ? '🎤 On' : '🔇 Off'}
        </button>
        <button type="button" className="btn btn-ghost" style={{ flex: 1, padding: '8px 6px', fontSize: 11 }} onClick={toggleCam}>
          {camOn ? '📷 On' : '📷 Off'}
        </button>
        <button type="button" className="btn btn-red" style={{ flex: 1, padding: '8px 6px', fontSize: 11 }} onClick={() => void handleEnd()}>
          End
        </button>
      </div>
    </div>
  )
}
