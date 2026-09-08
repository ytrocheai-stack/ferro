export const SUMMARY_RETRIEVAL_POLICY: string
export interface SummaryChunk { id: string; sourceId: string; location?: string; section?: string }
export function enrichWithSourceSummaries<T extends SummaryChunk>(matches: Array<{ id: string; score: number }>, chunks: T[], eligible?: (chunk: T) => boolean, limit?: number): Array<{ id: string; score: number }>
