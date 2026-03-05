import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis',
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    commonjsOptions: {
      include: [/zen-observable/, /node_modules/],
      transformMixedEsModules: true,
    },
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-aws': ['aws-amplify'],
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-ui': ['date-fns', 'qrcode.react'],
        },
      },
    },
  },
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      // Add alias for amplify_outputs.json to help Vite resolve it
      '@amplify-outputs': path.resolve(__dirname, './amplify_outputs.json'),
    },
  },
  optimizeDeps: {
    include: ['aws-amplify', 'zen-observable'],
    esbuildOptions: {
      mainFields: ['module', 'main'],
      define: {
        global: 'globalThis',
      },
    },
  },
})
