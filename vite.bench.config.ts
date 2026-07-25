import { defineConfig, mergeConfig } from 'vite'
import baseConfig from './vite.config'

export default mergeConfig(
  baseConfig,
  defineConfig({
    server: {
      port: 3001,
      open: '/bench/local-llm/',
    },
    build: {
      outDir: 'dist-llm-bench',
      rollupOptions: {
        input: {
          localLlmBench: 'bench/local-llm/index.html',
        },
      },
    },
  }),
)
