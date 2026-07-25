export interface CaseRunResult {
  caseId: string
  caseTitle: string
  rawAnswer: string
  answer: string
  evidenceIds: string[]
  unsupported: boolean
  passed: boolean
  score: number
  reasons: string[]
  criticalHallucination: boolean
  latencyMs: number
}

export interface ModelRunResult {
  modelId: string
  modelLabel: string
  cacheBefore: boolean | 'unknown'
  loadMs?: number
  error?: string
  cases: CaseRunResult[]
}

export interface BenchRunResult {
  startedAt: string
  finishedAt?: string
  userAgent: string
  webgpuAvailable: boolean
  cacheBackend: string
  models: ModelRunResult[]
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function exportJson(result: BenchRunResult) {
  downloadFile(
    `local-llm-bench-${result.startedAt.replace(/[:.]/g, '-')}.json`,
    JSON.stringify(result, null, 2),
    'application/json',
  )
}

export function exportCsv(result: BenchRunResult) {
  const rows = [
    [
      'model_id',
      'case_id',
      'passed',
      'score',
      'critical_hallucination',
      'latency_ms',
      'unsupported',
      'evidence_ids',
      'reasons',
      'answer',
    ],
  ]

  for (const model of result.models) {
    for (const testCase of model.cases) {
      rows.push([
        model.modelId,
        testCase.caseId,
        String(testCase.passed),
        String(testCase.score),
        String(testCase.criticalHallucination),
        String(testCase.latencyMs),
        String(testCase.unsupported),
        testCase.evidenceIds.join(' '),
        testCase.reasons.join('; '),
        testCase.answer,
      ])
    }
  }

  const csv = rows
    .map(row => row.map(value => `"${value.replace(/"/g, '""')}"`).join(','))
    .join('\n')
  downloadFile(`local-llm-bench-${result.startedAt.replace(/[:.]/g, '-')}.csv`, csv, 'text/csv')
}
