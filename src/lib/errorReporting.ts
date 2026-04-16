/**
 * Central place for client-side errors. Extend with Sentry or another backend when ready.
 * Set VITE_SENTRY_DSN in production to wire Sentry (optional future step).
 */

type ErrorContext = Record<string, unknown>

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error
  if (typeof error === 'string') return new Error(error)
  try {
    return new Error(JSON.stringify(error))
  } catch {
    return new Error('Unknown error')
  }
}

export function reportClientError(error: unknown, context?: ErrorContext): void {
  const err = normalizeError(error)
  const payload = {
    message: err.message,
    stack: err.stack,
    context,
    href: typeof window !== 'undefined' ? window.location.href : '',
    ts: new Date().toISOString(),
  }
  console.error('[Bizzkit error]', payload)

  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
  if (dsn?.trim()) {
    /* Future: init @sentry/react once and captureException(err, { extra: context }) */
  }
}

export function reportUnhandledError(reason: unknown): void {
  reportClientError(reason, { source: 'unhandled' })
}
