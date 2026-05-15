import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vite.dev/config/
export default defineConfig({
  server: {
    host: '127.0.0.1',
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  // Rollup's auto code-splitting produces circular cross-chunk imports between
  // the crypto/eth packages (viem, ox, @noble/*, @scure/*, permissionless,
  // zerodev, etc.). Because ESM bindings across chunks resolve at evaluate
  // time, top-level patterns like `validateObject({ hash: sha256 })` and
  // `class X extends BaseError` see `undefined` and throw at app init, leaving
  // <App/> unmounted on Vercel. Collapsing all of them into one vendor chunk
  // turns the cross-chunk circular refs into in-chunk refs, which JS handles.
  // (resolve.dedupe is not safe — @scure/bip32 needs @noble/hashes/legacy,
  // which only exists in pre-1.8 noble versions.)
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes('/@noble/') ||
            id.includes('/@scure/') ||
            id.includes('/node_modules/viem/') ||
            id.includes('/node_modules/ox/') ||
            id.includes('/node_modules/permissionless/') ||
            id.includes('/node_modules/@zerodev/') ||
            id.includes('/node_modules/abitype/') ||
            id.includes('/node_modules/eventemitter3/') ||
            id.includes('/node_modules/isows/') ||
            id.includes('/node_modules/ws/')
          ) {
            return 'eth-vendor';
          }
        },
      },
    },
  },
  plugins: [
    nodePolyfills({ include: ['buffer'] }),
    tailwindcss(),
    react(),
  ],
})
