/// <reference types="vite/client" />

interface ImportMetaEnv {
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
