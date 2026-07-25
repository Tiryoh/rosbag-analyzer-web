import type { BenchCase } from './cases'

export interface ParsedAnswer {
  answer: string
  evidenceIds: string[]
  unsupported: boolean
}

export interface ScoreResult {
  passed: boolean
  score: number
  reasons: string[]
  parsed: ParsedAnswer
  criticalHallucination: boolean
}

const emptyParsedAnswer: ParsedAnswer = {
  answer: '',
  evidenceIds: [],
  unsupported: false,
}

export function parseAnswer(raw: string): ParsedAnswer {
  const fencedJson = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fencedJson?.[1] ?? raw
  const firstBrace = candidate.indexOf('{')
  const lastBrace = candidate.lastIndexOf('}')

  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return { ...emptyParsedAnswer, answer: raw.trim() }
  }

  try {
    const parsed = JSON.parse(candidate.slice(firstBrace, lastBrace + 1)) as Partial<ParsedAnswer>
    return {
      answer: typeof parsed.answer === 'string' ? parsed.answer : raw.trim(),
      evidenceIds: Array.isArray(parsed.evidenceIds)
        ? parsed.evidenceIds.filter((id): id is string => typeof id === 'string')
        : [],
      unsupported: Boolean(parsed.unsupported),
    }
  } catch {
    return { ...emptyParsedAnswer, answer: raw.trim() }
  }
}

export function scoreAnswer(testCase: BenchCase, raw: string): ScoreResult {
  const parsed = parseAnswer(raw)
  const answerText = parsed.answer.toLowerCase()
  const evidence = new Set(parsed.evidenceIds)
  const reasons: string[] = []
  let score = 0

  for (const id of testCase.requiredEvidenceIds) {
    if (evidence.has(id)) {
      score += 2
    } else {
      reasons.push(`missing evidence ${id}`)
    }
  }

  for (const term of testCase.requiredTerms) {
    if (answerText.includes(term.toLowerCase())) {
      score += 1
    } else {
      reasons.push(`missing term "${term}"`)
    }
  }

  const forbiddenHits = testCase.forbiddenTerms.filter(term => answerText.includes(term.toLowerCase()))
  for (const term of forbiddenHits) {
    reasons.push(`forbidden term "${term}"`)
    score -= 2
  }

  if (testCase.expectUnsupported) {
    if (parsed.unsupported) {
      score += 3
    } else {
      reasons.push('unsupported should be true')
      score -= 3
    }
  } else if (parsed.unsupported) {
    reasons.push('unsupported should be false')
    score -= 2
  }

  const maxScore =
    testCase.requiredEvidenceIds.length * 2 +
    testCase.requiredTerms.length +
    (testCase.expectUnsupported ? 3 : 0)
  const normalized = maxScore === 0 ? Math.max(score, 0) : Math.max(score, 0) / maxScore
  const criticalHallucination = Boolean(testCase.expectUnsupported && forbiddenHits.length > 0)
  const passed = normalized >= 0.85 && reasons.length === 0 && !criticalHallucination

  return {
    passed,
    score: Number(normalized.toFixed(3)),
    reasons,
    parsed,
    criticalHallucination,
  }
}
