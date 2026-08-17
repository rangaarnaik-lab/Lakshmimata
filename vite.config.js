import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import obfuscator from 'rollup-plugin-obfuscator'

// Proprietary indicator formulas ship in the browser; obfuscate that chunk
// and never emit sourcemaps in production. True secrecy requires server-side compute.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  build: {
    sourcemap: false,
    minify: 'esbuild',
    target: 'es2018',
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('lakshmiProprietary')) return 'lm-core'
        },
      },
      plugins: mode === 'production'
        ? [
            obfuscator({
              include: ['**/lakshmiProprietary.js'],
              options: {
                compact: true,
                controlFlowFlattening: true,
                controlFlowFlatteningThreshold: 0.75,
                deadCodeInjection: false,
                debugProtection: false,
                disableConsoleOutput: true,
                identifierNamesGenerator: 'hexadecimal',
                renameGlobals: false,
                rotateStringArray: true,
                selfDefending: false,
                stringArray: true,
                stringArrayEncoding: ['base64'],
                stringArrayThreshold: 0.75,
                transformObjectKeys: true,
                unicodeEscapeSequence: false,
              },
            }),
          ]
        : [],
    },
  },
  esbuild: {
    drop: mode === 'production' ? ['console', 'debugger'] : [],
    legalComments: 'none',
  },
}))
