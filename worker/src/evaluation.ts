import {
  evaluateBenchmark,
  evaluateCitationPrecision,
  evaluateRecallAt5,
  passesDimensionGate,
  passesEvaluationGate,
  SYNTHETIC_FIXTURES,
  validateBenchmark,
  validateEvaluationResults,
} from '../../packages/corpus-evaluation/src/index.mjs'

export type RetrievalFixture = { query: number[]; relevantIds: string[]; documents: { id: string; vector: number[] }[] }
export type EvaluationDimensions = 512 | 768 | 1024
export type CitationClaim = { citedIds: string[]; supportedIds: string[] }
export type CitationFixture = { citedIds: string[]; validIds: string[]; claims?: CitationClaim[] }

export {
  evaluateBenchmark,
  evaluateCitationPrecision,
  evaluateRecallAt5,
  passesDimensionGate,
  passesEvaluationGate,
  SYNTHETIC_FIXTURES,
  validateBenchmark,
  validateEvaluationResults,
}
