import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import obfuscator from 'rollup-plugin-obfuscator'
import { handleUpstoxTokenRequest } from './api/upstox-token.js'
import { handleUpstoxSessionRequest } from './api/upstox-session.js'
import { handleUpstoxQuotesRequest } from './api/upstox-quotes.js'
import { handleUpstoxOAuthConfigRequest } from './api/upstox-oauth-config.js'

function upstoxOAuthDevPlugin(env) {
  return {
    name: 'upstox-oauth-dev',
    configureServer(server) {
      Object.assign(process.env, env)
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] || ''
        const handlers = {
          '/api/upstox-token': handleUpstoxTokenRequest,
          '/api/upstox-session': handleUpstoxSessionRequest,
          '/api/upstox-quotes': handleUpstoxQuotesRequest,
          '/api/upstox-oauth-config': handleUpstoxOAuthConfigRequest,
        }
        const handler = handlers[url]
        if (!handler) return next()
        handler(req, res).catch((err) => {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: err?.message || 'OAuth proxy failed' }))
        })
      })
    },
  }
}

// Proprietary indicator formulas ship in the browser; obfuscate that chunk
// and never emit sourcemaps in production. True secrecy requires server-side compute.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
  plugins: [react(), upstoxOAuthDevPlugin(env)],
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
}
})
