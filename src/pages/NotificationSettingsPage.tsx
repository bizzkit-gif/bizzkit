import React from 'react'
import { useNotificationSettings } from '../hooks/useNotificationSettings'

function Row({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        padding: '12px 0',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: '#fff' }}>{label}</div>
        <div style={{ fontSize: 11, color: '#7A92B0', marginTop: 4, lineHeight: 1.45 }}>{hint}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        style={{
          flexShrink: 0,
          width: 48,
          height: 28,
          borderRadius: 14,
          border: 'none',
          cursor: 'pointer',
          background: checked ? '#1E7EF7' : '#3A5070',
          position: 'relative',
          transition: 'background 0.2s',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 3,
            left: checked ? 24 : 4,
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left 0.2s',
          }}
        />
      </button>
    </div>
  )
}

export default function NotificationSettingsPage({ onBack }: { onBack: () => void }) {
  const [s, update] = useNotificationSettings()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="topbar" style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 16px 10px' }}>
        <button
          type="button"
          onClick={onBack}
          style={{ background: 'none', border: 'none', color: '#7A92B0', fontSize: 20, cursor: 'pointer' }}
        >
          ←
        </button>
        <div className="page-title">Notifications</div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 18px 28px' }}>
        <p style={{ fontSize: 12, color: '#7A92B0', lineHeight: 1.5, marginBottom: 8 }}>
          Control sounds and alerts in Bizzkit. Browser or system permissions may still apply for banners and push.
        </p>
        <Row
          label="Message sounds"
          hint="Play a short tone when you receive a new chat message while using the app."
          checked={s.soundMessages}
          onChange={(v) => update({ soundMessages: v })}
        />
        <Row
          label="Call sounds"
          hint="Play ring tones for incoming Chat or Random video calls."
          checked={s.soundCalls}
          onChange={(v) => update({ soundCalls: v })}
        />
        <Row
          label="Vibration"
          hint="Vibrate on supported devices for messages and calls."
          checked={s.haptics}
          onChange={(v) => update({ haptics: v })}
        />
        <Row
          label="Background banners"
          hint="Show system notifications when the tab is in the background (requires notification permission)."
          checked={s.backgroundBanners}
          onChange={(v) => update({ backgroundBanners: v })}
        />
        <Row
          label="Push when offline"
          hint="Register this device to receive push alerts when the app is closed (requires permission and server setup)."
          checked={s.pushRemote}
          onChange={(v) => update({ pushRemote: v })}
        />
      </div>
    </div>
  )
}
