import React, { useMemo, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { CheckCircle2, Download, Play, RotateCcw, Trash2, XCircle } from 'lucide-react'
import '../../web/index.css'
import { benchCases } from './cases'
import { benchCacheBackends, benchModels, defaultBenchCacheBackend, type BenchCacheBackend } from './models'
import { clearModelCache, readModelCacheState, runBenchmark, type ProgressEvent } from './runner'
import { exportCsv, exportJson, type BenchRunResult, type ModelRunResult } from './results'

type RunState = 'idle' | 'running' | 'done' | 'error'

function modelSummary(model: ModelRunResult) {
  if (model.error) return { passed: 0, total: 0, critical: 0 }
  return {
    passed: model.cases.filter(testCase => testCase.passed).length,
    total: model.cases.length,
    critical: model.cases.filter(testCase => testCase.criticalHallucination).length,
  }
}

function progressText(event: ProgressEvent | null) {
  if (!event) return 'Ready'
  if (event.kind === 'model-start') return `Loading ${event.modelId}`
  if (event.kind === 'model-load') return `${event.modelId}: ${event.report.text}`
  if (event.kind === 'case-start') return `${event.modelId}: running ${event.caseId}`
  if (event.kind === 'case-done') return `${event.modelId}: ${event.caseId} ${event.passed ? 'passed' : 'failed'}`
  return `${event.modelId}: ${event.error}`
}

export function App() {
  const [runState, setRunState] = useState<RunState>('idle')
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  const [result, setResult] = useState<BenchRunResult | null>(null)
  const [cacheStates, setCacheStates] = useState<Record<string, boolean | 'unknown'>>({})
  const [cacheBackend, setCacheBackend] = useState<BenchCacheBackend>(defaultBenchCacheBackend)
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(
    () => new Set(benchModels.map(model => model.id)),
  )
  const [clearCacheAfterModel, setClearCacheAfterModel] = useState(true)
  const [storageText, setStorageText] = useState<string>('unknown')
  const [error, setError] = useState<string | null>(null)

  const totals = useMemo(() => {
    if (!result) return { passed: 0, total: 0, critical: 0 }
    return result.models.reduce(
      (acc, model) => {
        const summary = modelSummary(model)
        return {
          passed: acc.passed + summary.passed,
          total: acc.total + summary.total,
          critical: acc.critical + summary.critical,
        }
      },
      { passed: 0, total: 0, critical: 0 },
    )
  }, [result])

  async function refreshCacheStates() {
    const entries = await Promise.all(
      benchModels.map(async model => [model.id, await readModelCacheState(model.id, cacheBackend)] as const),
    )
    setCacheStates(Object.fromEntries(entries))
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate()
      const usedGb = ((estimate.usage ?? 0) / 1024 ** 3).toFixed(2)
      const quotaGb = ((estimate.quota ?? 0) / 1024 ** 3).toFixed(2)
      setStorageText(`${usedGb} GB / ${quotaGb} GB`)
    }
  }

  async function startRun() {
    const selectedModels = benchModels.filter(model => selectedModelIds.has(model.id))
    if (selectedModels.length === 0) {
      setError('Select at least one model.')
      return
    }
    setRunState('running')
    setError(null)
    setResult(null)
    setProgress(null)
    try {
      const benchResult = await runBenchmark(selectedModels, cacheBackend, clearCacheAfterModel, setProgress)
      setResult(benchResult)
      setRunState('done')
      await refreshCacheStates()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setRunState('error')
    }
  }

  async function clearCaches() {
    setRunState('running')
      setError(null)
    try {
      for (const model of benchModels) {
        await clearModelCache(model.id, cacheBackend)
      }
      await refreshCacheStates()
      setRunState('idle')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setRunState('error')
    }
  }

  function toggleModel(modelId: string) {
    setSelectedModelIds(previous => {
      const next = new Set(previous)
      if (next.has(modelId)) {
        next.delete(modelId)
      } else {
        next.add(modelId)
      }
      return next
    })
  }

  return (
    <main className="min-h-screen bg-surface-50 text-surface-900 dark:bg-surface-950 dark:text-surface-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-col gap-4 border-b border-surface-200 pb-5 dark:border-surface-800 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-brand-700 dark:text-brand-300">ROSbag Analyzer dev bench</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-normal">Local LLM Log QA Benchmark</h1>
            <p className="mt-2 max-w-3xl text-sm text-surface-600 dark:text-surface-300">
              Runs WebLLM models in this browser against deterministic synthetic rosout and diagnostics QA cases.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={startRun}
              disabled={runState === 'running'}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Play size={16} />
              Run benchmark
            </button>
            <button
              type="button"
              onClick={refreshCacheStates}
              disabled={runState === 'running'}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-surface-300 px-3 text-sm font-medium hover:bg-surface-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-surface-700 dark:hover:bg-surface-900"
            >
              <RotateCcw size={16} />
              Cache state
            </button>
            <button
              type="button"
              onClick={clearCaches}
              disabled={runState === 'running'}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-red-300 px-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
            >
              <Trash2 size={16} />
              Clear model cache
            </button>
            <label className="flex h-10 items-center gap-2 rounded-md border border-surface-300 px-3 text-sm font-medium dark:border-surface-700">
              Cache
              <select
                value={cacheBackend}
                onChange={event => setCacheBackend(event.target.value as BenchCacheBackend)}
                disabled={runState === 'running'}
                className="bg-transparent text-sm outline-none disabled:cursor-not-allowed"
              >
                {benchCacheBackends.map(backend => (
                  <option key={backend} value={backend}>
                    {backend}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        <section className="mb-6 grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-surface-200 bg-white p-4 dark:border-surface-800 dark:bg-surface-900">
            <p className="text-xs font-medium uppercase text-surface-500">WebGPU</p>
            <p className="mt-2 text-2xl font-semibold">{'gpu' in navigator ? 'Available' : 'Unavailable'}</p>
          </div>
          <div className="rounded-lg border border-surface-200 bg-white p-4 dark:border-surface-800 dark:bg-surface-900">
            <p className="text-xs font-medium uppercase text-surface-500">Models</p>
            <p className="mt-2 text-2xl font-semibold">{benchModels.length}</p>
          </div>
          <div className="rounded-lg border border-surface-200 bg-white p-4 dark:border-surface-800 dark:bg-surface-900">
            <p className="text-xs font-medium uppercase text-surface-500">Cases</p>
            <p className="mt-2 text-2xl font-semibold">{benchCases.length}</p>
          </div>
          <div className="rounded-lg border border-surface-200 bg-white p-4 dark:border-surface-800 dark:bg-surface-900">
            <p className="text-xs font-medium uppercase text-surface-500">Pass rate</p>
            <p className="mt-2 text-2xl font-semibold">
              {totals.total > 0 ? `${Math.round((totals.passed / totals.total) * 100)}%` : '-'}
            </p>
          </div>
        </section>

        <section className="mb-6 rounded-lg border border-surface-200 bg-white p-4 dark:border-surface-800 dark:bg-surface-900">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-medium">Run controls</p>
              <p className="mt-1 text-sm text-surface-600 dark:text-surface-300">
                Browser storage estimate: {storageText}. Keep cache cleanup enabled when quota is tight.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={clearCacheAfterModel}
                onChange={event => setClearCacheAfterModel(event.target.checked)}
                disabled={runState === 'running'}
                className="h-4 w-4"
              />
              Clear each model cache after scoring
            </label>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {benchModels.map(model => (
              <label
                key={model.id}
                className="flex items-start gap-3 rounded-md border border-surface-200 p-3 text-sm dark:border-surface-800"
              >
                <input
                  type="checkbox"
                  checked={selectedModelIds.has(model.id)}
                  onChange={() => toggleModel(model.id)}
                  disabled={runState === 'running'}
                  className="mt-1 h-4 w-4"
                />
                <span>
                  <span className="block font-medium">{model.label}</span>
                  <span className="block break-all font-mono text-xs text-surface-500">{model.id}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="mb-6 rounded-lg border border-surface-200 bg-white p-4 dark:border-surface-800 dark:bg-surface-900">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-medium">Current status</p>
              <p className="mt-1 text-sm text-surface-600 dark:text-surface-300">{progressText(progress)}</p>
              <p className="mt-1 text-xs text-surface-500">
                Cache backend: {cacheBackend}; cleanup after model: {String(clearCacheAfterModel)}
              </p>
              {error && <p className="mt-2 text-sm text-red-600 dark:text-red-300">{error}</p>}
            </div>
            {result && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => exportJson(result)}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-surface-300 px-3 text-sm font-medium hover:bg-surface-100 dark:border-surface-700 dark:hover:bg-surface-800"
                >
                  <Download size={15} />
                  JSON
                </button>
                <button
                  type="button"
                  onClick={() => exportCsv(result)}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-surface-300 px-3 text-sm font-medium hover:bg-surface-100 dark:border-surface-700 dark:hover:bg-surface-800"
                >
                  <Download size={15} />
                  CSV
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="mb-6 grid gap-4 lg:grid-cols-2">
          {benchModels.map(model => (
            <article key={model.id} className="rounded-lg border border-surface-200 bg-white p-4 dark:border-surface-800 dark:bg-surface-900">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">{model.label}</h2>
                  <p className="mt-1 break-all font-mono text-xs text-surface-500">{model.id}</p>
                </div>
                <span className="rounded-md bg-surface-100 px-2 py-1 text-xs font-medium dark:bg-surface-800">
                  cache: {String(cacheStates[model.id] ?? 'unknown')}
                </span>
              </div>
              <p className="mt-3 text-sm text-surface-600 dark:text-surface-300">{model.notes}</p>
            </article>
          ))}
        </section>

        {result && (
          <section className="space-y-5">
            {result.models.map(model => {
              const summary = modelSummary(model)
              return (
                <article key={model.modelId} className="rounded-lg border border-surface-200 bg-white dark:border-surface-800 dark:bg-surface-900">
                  <div className="border-b border-surface-200 p-4 dark:border-surface-800">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h2 className="text-lg font-semibold">{model.modelLabel}</h2>
                        <p className="break-all font-mono text-xs text-surface-500">{model.modelId}</p>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs font-medium">
                        <span className="rounded-md bg-surface-100 px-2 py-1 dark:bg-surface-800">
                          load {model.loadMs ? `${model.loadMs} ms` : '-'}
                        </span>
                        <span className="rounded-md bg-surface-100 px-2 py-1 dark:bg-surface-800">
                          cache before {String(model.cacheBefore)}
                        </span>
                        <span className="rounded-md bg-surface-100 px-2 py-1 dark:bg-surface-800">
                          pass {summary.passed}/{summary.total}
                        </span>
                        <span className={`rounded-md px-2 py-1 ${summary.critical > 0 ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'}`}>
                          critical {summary.critical}
                        </span>
                      </div>
                    </div>
                    {model.error && <p className="mt-3 text-sm text-red-600 dark:text-red-300">{model.error}</p>}
                  </div>
                  {model.cases.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-surface-200 text-sm dark:divide-surface-800">
                        <thead className="bg-surface-100 text-left text-xs uppercase text-surface-500 dark:bg-surface-950">
                          <tr>
                            <th className="px-4 py-3">Case</th>
                            <th className="px-4 py-3">Result</th>
                            <th className="px-4 py-3">Evidence</th>
                            <th className="px-4 py-3">Answer</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-surface-200 dark:divide-surface-800">
                          {model.cases.map(testCase => (
                            <tr key={testCase.caseId}>
                              <td className="w-56 px-4 py-3 align-top">
                                <p className="font-medium">{testCase.caseTitle}</p>
                                <p className="font-mono text-xs text-surface-500">{testCase.caseId}</p>
                                <p className="mt-1 text-xs text-surface-500">{testCase.latencyMs} ms</p>
                              </td>
                              <td className="w-40 px-4 py-3 align-top">
                                <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${testCase.passed ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'}`}>
                                  {testCase.passed ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                                  {testCase.passed ? 'pass' : 'fail'} {testCase.score}
                                </span>
                                {testCase.reasons.length > 0 && (
                                  <p className="mt-2 text-xs text-red-600 dark:text-red-300">{testCase.reasons.join('; ')}</p>
                                )}
                              </td>
                              <td className="w-36 px-4 py-3 align-top font-mono text-xs">
                                {testCase.evidenceIds.join(', ') || '-'}
                              </td>
                              <td className="min-w-96 px-4 py-3 align-top">
                                <p className="text-sm">{testCase.answer || testCase.rawAnswer}</p>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </article>
              )
            })}
          </section>
        )}
      </div>
    </main>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
