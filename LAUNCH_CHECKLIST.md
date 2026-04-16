# Bizzkit launch checklist

Use this before production and store submissions. Check items off as you complete them.

## Blockers

- [ ] Real-device QA: message notifications (foreground, background, locked phone, app killed).
- [ ] Real-device QA: incoming Chat + Random call alerts and missed-call flows.
- [ ] Crash / error monitoring enabled in production (e.g. Sentry + `VITE_SENTRY_DSN` when wired).
- [ ] Privacy policy and terms finalized and published (replace placeholders in app Legal screen).
- [ ] Support contact email and account / data deletion process documented for users.
- [ ] Repo clean: no committed `dist/`, `node_modules/`, or `supabase/.temp/` artifacts.

## Important

- [ ] Messaging + presence soak test on Safari, Chrome, and Android (weak network, backgrounding).
- [ ] Push notifications verified when realtime is delayed or client offline.
- [ ] Auth edge cases: reinstall, session expiry, password reset, logout/login.
- [ ] Notification and Web Audio permission UX when users deny browser permissions.
- [ ] Performance pass on mid-range Android (feed, chat, video call startup).
- [ ] Loading, empty, and error states reviewed on main flows.

## Store readiness

- [ ] Android strategy chosen (PWA / TWA / native wrapper) and store listing prepared.
- [ ] iOS strategy chosen (native wrapper usually required for App Store).
- [ ] Icons, splash, screenshots, descriptions, and permission strings prepared.
- [ ] Age rating and regional compliance reviewed.

## Post-launch

- [ ] Analytics for signup, message send, call start, notification open.
- [ ] User-facing notification settings (sound, push, calls) if desired.
- [ ] Accessibility and reduced-motion review.
