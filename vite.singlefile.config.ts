import { defineConfig, mergeConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import baseConfig from './vite.config'

export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [viteSingleFile()],
    build: {
      outDir: 'dist-singlefile',
      sourcemap: false,
      cssCodeSplit: false,
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  }),
)
