import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    // Prefer IPv4 — on some macOS setups `localhost` fails while 127.0.0.1 works
    host: '127.0.0.1',
    strictPort: true,
    open: true,
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('@supabase') || id.includes('supabase-js')) return 'supabase'
          if (id.includes('react-dom') || id.includes('node_modules/react/')) return 'react-vendor'
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
})
