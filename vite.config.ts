import { copyFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

function copyThirdPartyLicensesWhenLlm(): Plugin {
  let outDir = 'dist'
  const licensePath = resolve('THIRD_PARTY_LICENSES.md')
  return {
    name: 'copy-third-party-licenses-when-llm',
    configResolved(config) {
      outDir = config.build.outDir
    },
    configureServer(server) {
      if (process.env.VITE_ENABLE_LLM !== '1') return
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0] ?? ''
        if (path.endsWith('/THIRD_PARTY_LICENSES.md')) {
          res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
          res.end(readFileSync(licensePath))
          return
        }
        next()
      })
    },
    closeBundle() {
      if (process.env.VITE_ENABLE_LLM !== '1') return
      copyFileSync(licensePath, resolve(outDir, 'THIRD_PARTY_LICENSES.md'))
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), copyThirdPartyLicensesWhenLlm()],
  base: './',
  define: {
    // Static replacement so the SQL console chunk is dropped when the flag is unset/off.
    'import.meta.env.VITE_ENABLE_LLM': JSON.stringify(process.env.VITE_ENABLE_LLM ?? ''),
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
  },
  server: {
    port: 3000,
    open: true,
  },
  test: {
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
