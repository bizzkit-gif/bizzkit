import React, { useState, useEffect, useCallback } from 'react'
import { useNotificationSettings } from '../hooks/useNotificationSettings'
import { useApp } from '../context/ctx'
import { sb } from '../lib/db'

function Row({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  const dim = !!disabled
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        padding: '12px 0',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        opacity: dim ? 0.55 : 1,
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
        disabled={dim}
        onClick={() => {
          if (!dim) onChange(!checked)
        }}
        style={{
          flexShrink: 0,
          width: 48,
          height: 28,
          borderRadius: 14,
          border: 'none',
          cursor: dim ? 'not-allowed' : 'pointer',
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
  const { myBiz, toast, refreshBiz } = useApp()
  const [inviteEmail, setInviteEmail] = useState(true)
  const [calendarReminders, setCalendarReminders] = useState(true)
  const [sessionSaving, setSessionSaving] = useState(false)

  useEffect(() => {
    if (!myBiz) return
    setInviteEmail(myBiz.notify_session_invite_email !== false)
    setCalendarReminders(myBiz.notify_session_calendar_reminders !== false)
  }, [myBiz?.id, myBiz?.notify_session_invite_email, myBiz?.notify_session_calendar_reminders])

  const persistSessionField = useCallback(
    async (patch: {
      notify_session_invite_email?: boolean
      notify_session_calendar_reminders?: boolean
    }): Promise<boolean> => {
      if (!myBiz?.id) return false
      setSessionSaving(true)
      const { error } = await sb.from('businesses').update(patch).eq('id', myBiz.id)
      setSessionSaving(false)
      if (error) {
        toast(error.message, 'error')
        return false
      }
      await refreshBiz()
      window.dispatchEvent(new Event('bizzkit-notification-settings'))
      toast('Session notification preference saved', 'success')
      return true
    },
    [myBiz?.id, refreshBiz, toast],
  )

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
          Control sounds, alerts, and session-related email for your business profile.
        </p>

        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: '#9BB0CC',
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            marginTop: 6,
            marginBottom: 2,
          }}
        >
          Session emails
        </div>
        <p style={{ fontSize: 11, color: '#7A92B0', lineHeight: 1.45, marginBottom: 4 }}>
          Uses your account login email. In-app chat is unchanged.
        </p>
        {!myBiz ? (
          <p style={{ fontSize: 12, color: '#7A92B0', padding: '10px 0 14px' }}>
            Create a business profile first — then you can turn session emails on or off here.
          </p>
        ) : (
          <>
            <Row
              label="Email when invited to a session"
              hint="When someone invites your business to a Connect session, we can email you in addition to in-app chat."
              checked={inviteEmail}
              disabled={sessionSaving}
              onChange={(v) => {
                const prev = inviteEmail
                setInviteEmail(v)
                void persistSessionField({ notify_session_invite_email: v }).then((ok) => {
                  if (!ok) setInviteEmail(prev)
                })
              }}
            />
            <Row
              label="Calendar reminders for sessions you joined"
              hint="Email reminders before sessions you have signed up for (in addition to in-app messages when enabled)."
              checked={calendarReminders}
              disabled={sessionSaving}
              onChange={(v) => {
                const prev = calendarReminders
                setCalendarReminders(v)
                void persistSessionField({ notify_session_calendar_reminders: v }).then((ok) => {
                  if (!ok) setCalendarReminders(prev)
                })
              }}
            />
          </>
        )}

        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: '#9BB0CC',
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            marginTop: 18,
            marginBottom: 2,
          }}
        >
          In the app
        </div>
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
