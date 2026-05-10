/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL, e.g. https://xxxxx.supabase.co (Dashboard → Settings → API) */
  readonly VITE_SUPABASE_URL?: string
  /** Supabase public key: legacy anon JWT or `sb_publishable_...` — same API settings screen */
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_SUPPORT_EMAIL?: string
  readonly VITE_WEB_PUSH_PUBLIC_KEY?: string
  readonly VITE_SENTRY_DSN?: string
  readonly VITE_WEBRTC_TURN_URL?: string
  readonly VITE_WEBRTC_TURN_USER?: string
  readonly VITE_WEBRTC_TURN_CREDENTIAL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
