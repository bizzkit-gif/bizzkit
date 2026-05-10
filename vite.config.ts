import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { DEFAULT_SUPABASE_URL } from './src/lib/supabaseDefaults'

function supabaseOriginForIndex(mode: string): string {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const raw = (env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL).trim().replace(/\/$/, '')
  try {
    return new URL(raw).origin
  } catch {
    return DEFAULT_SUPABASE_URL.replace(/\/$/, '')
  }
}

function authStorageKeyForIndex(mode: string): string {
  try {
    const host = new URL(supabaseOriginForIndex(mode)).hostname.split('.')[0]
    return `sb-${host}-auth-token`
  } catch {
    return 'sb-ganberetmowmaidioryu-auth-token'
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    {
      name: 'bk-supabase-index-placeholders',
      transformIndexHtml(html) {
        const origin = supabaseOriginForIndex(mode)
        const authKey = authStorageKeyForIndex(mode)
        return html.replaceAll('__BK_SUPABASE_ORIGIN__', origin).replaceAll('__BK_AUTH_STORAGE_KEY__', authKey)
      },
    },
  ],
  server: {
    port: 3000,
    // Prefer IPv4 — on some macOS setups `localhost` fails while 127.0.0.1 works
    host: '127.0.0.1',
    strictPort: true,
    open: true,
  },
  build: { outDir: 'dist' },
}))
