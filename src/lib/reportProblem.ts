/**
 * Opens the device mail client with a prefilled support message.
 * Override with `VITE_SUPPORT_EMAIL` in `.env` / Vercel when you want a different inbox.
 */
export function openReportProblem(accountHint?: string | null): void {
  const support = (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined)?.trim() || 'babek.sawhney@gmail.com'
  const lines = [
    'Please describe what went wrong:',
    '',
    `Page: ${typeof window !== 'undefined' ? window.location.href : ''}`,
    `Time: ${new Date().toISOString()}`,
    ...(accountHint ? [`Account id: ${accountHint}`] : []),
    `User agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : ''}`,
  ]
  const body = lines.join('\n')
  const href = `mailto:${support}?subject=${encodeURIComponent('Bizzkit — report')}&body=${encodeURIComponent(body)}`
  window.location.href = href
}
