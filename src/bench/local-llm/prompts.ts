import type { BenchCase, LogRow } from './cases'

function formatRow(row: LogRow): string {
  const values = row.values ? ` values=${JSON.stringify(row.values)}` : ''
  return `[${row.id}] ${row.timestamp} ${row.source} ${row.level} ${row.node}: ${row.message}${values}`
}

export function buildMessages(testCase: BenchCase) {
  const rows = testCase.rows.map(formatRow).join('\n')

  return [
    {
      role: 'system' as const,
      content:
        'You answer questions about ROS rosout and diagnostics logs. Use only the provided log rows. ' +
        'If the logs do not contain enough evidence, say that it cannot be determined and set unsupported=true. ' +
        'Do not invent causes, components, values, timestamps, or events. ' +
        'Return only compact JSON with keys: answer, evidenceIds, unsupported.',
    },
    {
      role: 'user' as const,
      content:
        `Question: ${testCase.question}\n\n` +
        `Log rows:\n${rows}\n\n` +
        'Return JSON only. evidenceIds must contain only IDs shown in the log rows.',
    },
  ]
}
