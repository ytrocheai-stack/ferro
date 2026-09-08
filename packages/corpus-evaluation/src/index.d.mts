export declare const EVALUATION_QUERY_COUNT: 50
export declare function evaluateContextRecallAt5(citations: unknown[], reference: unknown, manifest: unknown): number
export declare const EVALUATION_DIMENSIONS: readonly [512, 1024]
export declare function validateBenchmark(reference: unknown, manifest: unknown): { ids: Set<string>; queryIds: Set<string>; ready: boolean }
export declare function validateEvaluationResults(results: unknown, reference: unknown, manifest: unknown): unknown
export declare function evaluateBenchmark(reference: unknown, manifest: unknown, results: unknown): unknown
export declare function evaluateRecallAt5(fixtures: unknown[], dimensions: 512 | 768 | 1024): number
export declare function evaluateCitationPrecision(fixtures: unknown[]): number
export declare function passesEvaluationGate(fixtures: unknown[], citationFixtures: unknown[], dimensions: 512 | 1024): boolean
export declare function passesDimensionGate(fixtures: unknown[], citationPrecision512: number, citationPrecision1024: number): boolean
export declare const SYNTHETIC_FIXTURES: unknown[]

export declare function responseFingerprint(item: unknown, dimensions: number, corpusVersion: string, benchmarkVersion: string): string
