import React, { useState, useEffect, useRef, useCallback } from 'react'
import { sb, Business } from '../lib/db'

type LiveSignal = {
  type: 'join' | 'offer' | 'answer' | 'ice'
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
 * In-app 1:1 video using WebRTC + Supabase broadcast (same signaling model as Go Random).
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
  const localStreamRef = useRef<MediaStream | null>(null)
  const channelRef = useRef<ReturnType<typeof sb.channel> | null>(null)
  const peerRef = useRef<RTCPeerConnection | null>(null)
  const peerIdRef = useRef<string>(`peer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const remoteConnectedRef = useRef(false)

  const sub = subtitleLine ?? `${other.industry} · ${other.city}`
  const hint = connectingHint ?? `Connecting… waiting for ${other.name}.`

  const sendSignal = useCallback(
    (sig: LiveSignal) => {
      const ch = channelRef.current
      if (!ch) return
      ch.send({ type: 'broadcast', event: 'signal', payload: sig })
    },
    []
  )

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
      const stream = e.streams?.[0]
      if (stream) {
        remoteConnectedRef.current = true
        setRemoteStream(stream)
      }
    }
    pc.onicecandidate = (e) => {
      if (e.candidate) sendSignal({ type: 'ice', from: peerIdRef.current, to: '*', payload: e.candidate, bizName: myBiz.name })
    }
    peerRef.current = pc
    return pc
  }, [myBiz.name, sendSignal])

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
        if (localVideoRef.current) localVideoRef.current.srcObject = local

        const ch = sb
          .channel(signalingChannelId)
          .on('broadcast', { event: 'signal' }, async ({ payload }: { payload: LiveSignal }) => {
            const msg = payload
            if (!msg || msg.from === peerIdRef.current) return
            if (msg.type === 'join') {
              const pc = createPeer()
              const offer = await pc.createOffer()
              await pc.setLocalDescription(offer)
              sendSignal({ type: 'offer', from: peerIdRef.current, payload: offer, bizName: myBiz.name })
            }
            if (msg.type === 'offer') {
              const pc = createPeer()
              await pc.setRemoteDescription(new RTCSessionDescription(msg.payload as RTCSessionDescriptionInit))
              const answer = await pc.createAnswer()
              await pc.setLocalDescription(answer)
              sendSignal({ type: 'answer', from: peerIdRef.current, payload: answer, bizName: myBiz.name })
            }
            if (msg.type === 'answer') {
              const pc = createPeer()
              await pc.setRemoteDescription(new RTCSessionDescription(msg.payload as RTCSessionDescriptionInit))
            }
            if (msg.type === 'ice') {
              const pc = createPeer()
              if (msg.payload) await pc.addIceCandidate(new RTCIceCandidate(msg.payload as RTCIceCandidateInit))
            }
          })
          .subscribe((status: string) => {
            if (status === 'SUBSCRIBED') {
              sendSignal({ type: 'join', from: peerIdRef.current, bizName: myBiz.name })
              setStarting(false)
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
      const ch = channelRef.current
      if (ch) sb.removeChannel(ch)
      const pc = peerRef.current
      if (pc) pc.close()
      const local = localStreamRef.current
      if (local) local.getTracks().forEach((t) => t.stop())
      channelRef.current = null
      peerRef.current = null
      localStreamRef.current = null
    }
  }, [createPeer, myBiz.name, signalingChannelId, sendSignal])

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
                autoPlay
                playsInline
                style={{ flex: 1, minHeight: 0, width: '100%', objectFit: 'cover', display: 'block' }}
                ref={(el) => {
                  if (el && el.srcObject !== remoteStream) el.srcObject = remoteStream
                }}
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
