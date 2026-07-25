import {
  CreateWebWorkerMLCEngine,
  deleteModelAllInfoInCache,
  hasModelInCache,
  type ChatCompletionRequest,
  type InitProgressReport,
  type MLCEngineInterface,
} from '@mlc-ai/web-llm'
import { benchCases } from './cases'
import { createBenchAppConfig, type BenchCacheBackend, type BenchModel } from './models'
import { buildMessages } from './prompts'
import type { BenchRunResult, CaseRunResult, ModelRunResult } from './results'
import { scoreAnswer } from './scoring'

export type ProgressEvent =
  | { kind: 'model-start'; modelId: string }
  | { kind: 'model-load'; modelId: string; report: InitProgressReport }
  | { kind: 'case-start'; modelId: string; caseId: string }
  | { kind: 'case-done'; modelId: string; caseId: string; passed: boolean }
  | { kind: 'model-error'; modelId: string; error: string }

export async function clearModelCache(modelId: string, cacheBackend: BenchCacheBackend) {
  await deleteModelAllInfoInCache(modelId, createBenchAppConfig(cacheBackend))
}

export async function readModelCacheState(
  modelId: string,
  cacheBackend: BenchCacheBackend,
): Promise<boolean | 'unknown'> {
  try {
    return await hasModelInCache(modelId, createBenchAppConfig(cacheBackend))
  } catch {
    return 'unknown'
  }
}

export async function runBenchmark(
  models: BenchModel[],
  cacheBackend: BenchCacheBackend,
  clearCacheAfterModel: boolean,
  onProgress: (event: ProgressEvent) => void,
): Promise<BenchRunResult> {
  const appConfig = createBenchAppConfig(cacheBackend)
  const result: BenchRunResult = {
    startedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    webgpuAvailable: 'gpu' in navigator,
    cacheBackend,
    models: [],
  }

  for (const model of models) {
    onProgress({ kind: 'model-start', modelId: model.id })
    const modelResult: ModelRunResult = {
      modelId: model.id,
      modelLabel: model.label,
      cacheBefore: await readModelCacheState(model.id, cacheBackend),
      cases: [],
    }
    result.models.push(modelResult)

    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    let engine: MLCEngineInterface | undefined

    try {
      const loadStart = performance.now()
      engine = await CreateWebWorkerMLCEngine(worker, model.id, {
        appConfig,
        initProgressCallback: report => onProgress({ kind: 'model-load', modelId: model.id, report }),
      })
      modelResult.loadMs = Math.round(performance.now() - loadStart)

      for (const testCase of benchCases) {
        onProgress({ kind: 'case-start', modelId: model.id, caseId: testCase.id })
        const request: ChatCompletionRequest = {
          messages: buildMessages(testCase),
          temperature: 0,
          max_tokens: 384,
        }
        const start = performance.now()
        const response = await engine.chat.completions.create(request)
        const rawAnswer = response.choices[0]?.message.content ?? ''
        const score = scoreAnswer(testCase, rawAnswer)
        const caseResult: CaseRunResult = {
          caseId: testCase.id,
          caseTitle: testCase.title,
          rawAnswer,
          answer: score.parsed.answer,
          evidenceIds: score.parsed.evidenceIds,
          unsupported: score.parsed.unsupported,
          passed: score.passed,
          score: score.score,
          reasons: score.reasons,
          criticalHallucination: score.criticalHallucination,
          latencyMs: Math.round(performance.now() - start),
        }
        modelResult.cases.push(caseResult)
        onProgress({ kind: 'case-done', modelId: model.id, caseId: testCase.id, passed: score.passed })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      modelResult.error = message
      onProgress({ kind: 'model-error', modelId: model.id, error: message })
    } finally {
      if (engine) {
        await engine.unload()
      }
      if (clearCacheAfterModel) {
        try {
          await deleteModelAllInfoInCache(model.id, appConfig)
        } catch {
          // A failed partial download may not have every cache entry. Keep the benchmark moving.
        }
      }
      worker.terminate()
    }
  }

  result.finishedAt = new Date().toISOString()
  return result
}
