import { prebuiltAppConfig, type AppConfig } from '@mlc-ai/web-llm'

export interface BenchModel {
  id: string
  label: string
  notes: string
}

export const benchModels: BenchModel[] = [
  {
    id: 'gemma-2-2b-it-q4f16_1-MLC',
    label: 'Gemma 2 2B IT',
    notes: 'Global Gemma 2 2B, q4f16, 4096 context, requires shader-f16.',
  },
  {
    id: 'gemma-2-2b-jpn-it-q4f16_1-MLC',
    label: 'Gemma 2 2B JPN IT',
    notes: 'Japanese-tuned Gemma 2 2B, q4f16, 4096 context, requires shader-f16.',
  },
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen2.5 1.5B Instruct',
    notes: 'Compact multilingual baseline, q4f16, 4096 context.',
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f32_1-MLC',
    label: 'Llama 3.2 1B Instruct',
    notes: 'Small Llama baseline, q4f32, 4096 context.',
  },
]

export type BenchCacheBackend = Extract<NonNullable<AppConfig['cacheBackend']>, 'cache' | 'indexeddb' | 'opfs'>

export const defaultBenchCacheBackend: BenchCacheBackend = 'indexeddb'

export const benchCacheBackends: BenchCacheBackend[] = ['indexeddb', 'opfs', 'cache']

export function createBenchAppConfig(cacheBackend: BenchCacheBackend): AppConfig {
  return {
    ...prebuiltAppConfig,
    cacheBackend,
  }
}
