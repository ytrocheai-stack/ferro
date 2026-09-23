import { canonicalJson, sha256Base64url } from '../../corpus-identity/src/index.mjs'
import { SUMMARY_RETRIEVAL_POLICY } from '../../corpus-retrieval/src/summary-context.mjs'

export const EVALUATION_QUERY_COUNT = 50
export const EVALUATION_DIMENSIONS = [512, 1024]
export function evaluateContextRecallAt5(citations, reference, manifest) {
  const chunks = new Map(manifest.chunks.map(chunk => [chunk.id, chunk.text]))
  const byQuery = new Map(citations.map(item => [item.queryId, item]))
  if (byQuery.size !== reference.queries.length || citations.length !== reference.queries.length) fail('cobertura de contexto incompleta o duplicada')
  let total = 0
  for (const query of reference.queries) {
    const item = byQuery.get(query.queryId)
    if (!item || !Array.isArray(item.retrievedContext) || !Array.isArray(item.retrievedChunkIds)) fail('falta contexto entregado')
    const ids = item.retrievedContext.map(chunk => chunk.id)
    if (new Set(ids).size !== ids.length || JSON.stringify(ids) !== JSON.stringify(item.retrievedChunkIds) || item.retrievedContext.some(chunk => !chunks.has(chunk.id) || chunks.get(chunk.id) !== chunk.text)) fail('contexto entregado no coincide con el corpus y el orden de recuperación')
    total += ids.slice(0, 5).filter(id => query.relevantChunkIds.includes(id)).length / query.relevantChunkIds.length
  }
  return total / reference.queries.length
}

function fail(message) {
  throw new Error(`Evaluación inválida: ${message}`)
}

function asArray(value, label) {
  if (!Array.isArray(value)) fail(`${label} debe ser un arreglo`)
  return value
}

function uniqueStrings(value, label, { allowEmpty = true } = {}) {
  const ids = asArray(value, label)
  if (!allowEmpty && ids.length === 0) fail(`${label} no puede estar vacío`)
  if (ids.some((id) => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length) fail(`${label} contiene valores vacíos o duplicados`)
  return ids
}

function corpusReady(manifest) {
  return manifest?.status === 'approved' && Array.isArray(manifest.sources) && Array.isArray(manifest.chunks) && manifest.chunks.length > 0 && manifest.sources.length > 0 && manifest.sources.every((source) => source?.approved === true)
}

function corpusIds(manifest) {
  if (!manifest || typeof manifest.corpusVersion !== 'string' || !manifest.corpusVersion) fail('el manifiesto carece de corpusVersion')
  if (!Array.isArray(manifest.sources) || !Array.isArray(manifest.chunks)) fail('el manifiesto carece de fuentes o chunks')
  const sources = new Map()
  for (const source of manifest.sources) {
    if (!source || typeof source.id !== 'string' || !source.id || typeof source.approved !== 'boolean') fail('fuente incompleta')
    if (sources.has(source.id)) fail(`fuente duplicada: ${source.id}`)
    sources.set(source.id, source)
  }
  const ids = new Set()
  for (const chunk of manifest.chunks) {
    if (!chunk || typeof chunk.id !== 'string' || !chunk.id || typeof chunk.sourceId !== 'string' || !chunk.text?.trim()) fail('chunk incompleto')
    if (ids.has(chunk.id)) fail(`chunk duplicado: ${chunk.id}`)
    if (!sources.has(chunk.sourceId)) fail(`chunk ${chunk.id} referencia una fuente inexistente`)
    ids.add(chunk.id)
  }
  return ids
}

function assertSubset(ids, allowed, label, { allowEmpty = true } = {}) {
  uniqueStrings(ids, label, { allowEmpty })
  if (ids.some((id) => !allowed.has(id))) fail(`${label} contiene IDs ajenos al corpus`)
}

export function validateBenchmark(reference, manifest) {
  const ids = corpusIds(manifest)
  if (!corpusReady(manifest)) fail('el corpus no está aprobado y listo')
  if (!reference || typeof reference !== 'object' || !['approved', 'frozen-draft'].includes(reference.status) || typeof reference.version !== 'string' || !reference.version || reference.corpusVersion !== manifest.corpusVersion) fail('la referencia debe estar aprobada y vinculada a la versión exacta del corpus')
  const queries = asArray(reference.queries, 'queries')
  if (queries.length !== EVALUATION_QUERY_COUNT) fail(`la referencia debe contener exactamente ${EVALUATION_QUERY_COUNT} consultas`)
  const queryIds = new Set()
  for (const query of queries) {
    if (!query || typeof query.queryId !== 'string' || !query.queryId || queryIds.has(query.queryId) || typeof query.text !== 'string' || !query.text.trim()) fail('queryId duplicado o consulta sin texto')
    queryIds.add(query.queryId)
    assertSubset(query.relevantChunkIds, ids, `${query.queryId}.relevantChunkIds`, { allowEmpty: false })
    assertSubset(query.hardNegativeChunkIds, ids, `${query.queryId}.hardNegativeChunkIds`, { allowEmpty: false })
    if (query.relevantChunkIds.some((id) => query.hardNegativeChunkIds.includes(id))) fail(`${query.queryId} mezcla relevantes y negativos difíciles`)
    const claims = asArray(query.claims, `${query.queryId}.claims`)
    if (!claims.length) fail(`${query.queryId} carece de afirmaciones etiquetadas`)
    const claimIds = new Set()
    for (const claim of claims) {
      if (!claim || typeof claim.claimId !== 'string' || !claim.claimId || claimIds.has(claim.claimId) || typeof claim.text !== 'string' || !claim.text.trim()) fail(`${query.queryId} contiene una afirmación sin texto o duplicada`)
      claimIds.add(claim.claimId)
      assertSubset(claim.supportedChunkIds, ids, `${query.queryId}.${claim.claimId}.supportedChunkIds`, { allowEmpty: false })
    }
  }
  return { ids, queryIds, ready: corpusReady(manifest) && reference.status === 'approved' }
}

function assertVector(vector, label) {
  if (!Array.isArray(vector) || vector.length !== 2048 || vector.some((item) => typeof item !== 'number' || !Number.isFinite(item))) fail(`${label} debe tener exactamente 2048 números finitos`)
  for (const dimensions of EVALUATION_DIMENSIONS) {
    const norm = Math.hypot(...vector.slice(0, dimensions))
    if (!Number.isFinite(norm) || norm === 0) fail(`${label} tiene una norma cero en el prefijo ${dimensions}`)
  }
}

function cosine(a, b, dimensions) {
  let dot = 0
  let an = 0
  let bn = 0
  for (let index = 0; index < dimensions; index += 1) {
    dot += a[index] * b[index]
    an += a[index] ** 2
    bn += b[index] ** 2
  }
  return an && bn ? dot / Math.sqrt(an * bn) : 0
}

function exactQueryCoverage(items, expected, label) {
  const list = asArray(items, label)
  if (list.length !== expected.size) fail(`${label} no cubre exactamente el benchmark`)
  const seen = new Set()
  for (const item of list) {
    if (!item || typeof item.queryId !== 'string' || !expected.has(item.queryId) || seen.has(item.queryId)) fail(`${label} contiene queryId ausente, extra o duplicado`)
    seen.add(item.queryId)
  }
  return list
}

function exactClaimCoverage(items, expected, label) {
  const list = asArray(items, label)
  if (list.length !== expected.size) fail(`${label} no cubre exactamente las afirmaciones de referencia`)
  const seen = new Set()
  for (const item of list) {
    if (!item || typeof item.claimId !== 'string' || !expected.has(item.claimId) || seen.has(item.claimId)) fail(`${label} contiene claimId ausente, extra o duplicado`)
    seen.add(item.claimId)
  }
  return list
}

function matrixFromResults(results, ids) {
  const matrix = results.matrix ?? results.documents
  if (matrix === undefined) {
    const first = results.retrieval?.[0]
    if (Array.isArray(first?.documents)) return matrixFromResults({ matrix: first.documents }, ids)
    fail('falta la matriz compartida de vectores')
  }
  const list = asArray(matrix, 'matrix')
  if (list.length !== ids.size) fail('la matriz no cubre exactamente el corpus evaluado')
  const seen = new Set()
  const normalized = []
  for (const item of list) {
    const id = item?.id ?? item?.chunkId
    if (typeof id !== 'string' || seen.has(id) || !ids.has(id)) fail('la matriz contiene IDs duplicados o ajenos al corpus')
    assertVector(item.vector ?? item.values, `vector ${id}`)
    seen.add(id)
    normalized.push({ id, vector: item.vector ?? item.values })
  }
  if (seen.size !== ids.size) fail('la matriz omite chunks del corpus')
  return normalized
}

function validateResultLabels(results) {
  const forbidden = ['relevantIds', 'validIds', 'supportedIds']
  const walk = (value) => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(walk); return }
    for (const key of forbidden) if (Object.hasOwn(value, key)) fail(`los resultados no pueden autorizarse con ${key}`)
    Object.values(value).forEach(walk)
  }
  walk(results)
}

function normalizeCitationSets(results) {
  if (results.citations && !Array.isArray(results.citations) && typeof results.citations === 'object') return { 512: results.citations['512'], 1024: results.citations['1024'] }
  return { 512: results.citations, 1024: results.citations1024 }
}

export function validateEvaluationResults(results, reference, manifest) {
  const benchmark = validateBenchmark(reference, manifest)
  if (!results || typeof results !== 'object' || results.benchmarkVersion !== reference.version || results.corpusVersion !== manifest.corpusVersion) fail('los resultados no corresponden al benchmark o corpus')
  validateResultLabels(results)
  const retrieval = exactQueryCoverage(results.retrieval, benchmark.queryIds, 'retrieval')
  const citationSets = normalizeCitationSets(results)
  const citations512 = exactQueryCoverage(citationSets[512], benchmark.queryIds, 'citations 512')
  const citations1024 = exactQueryCoverage(citationSets[1024], benchmark.queryIds, 'citations 1024')
  const matrix = matrixFromResults(results, benchmark.ids)
  const matrixIds = new Set(matrix.map((item) => item.id))
  const queryById = new Map(reference.queries.map((query) => [query.queryId, query]))
  for (const item of retrieval) {
    assertVector(item.query ?? item.vector, `consulta ${item.queryId}`)
    if (item.documents) {
      if (!Array.isArray(item.documents) || item.documents.length !== matrix.length || item.documents.some((document) => !matrixIds.has(document.id ?? document.chunkId))) fail(`retrieval ${item.queryId} no usa la matriz completa`)
      const documentIds = item.documents.map((document) => document?.id ?? document?.chunkId)
      if (documentIds.some((id) => typeof id !== 'string') || new Set(documentIds).size !== matrixIds.size || documentIds.some((id) => !matrixIds.has(id))) fail(`retrieval ${item.queryId} no usa exactamente la matriz completa`)
    }
  }
  for (const set of [citations512, citations1024]) {
    for (const item of set) {
    const referenceQuery = queryById.get(item.queryId)
      const referenceClaims = new Map(referenceQuery.claims.map((claim) => [claim.claimId, claim]))
      if (results.schema === 'generated-benchmark-v1' || results.schema === 'generated-benchmark-v2' || results.schema === 'generated-benchmark-v3' || results.schema === 'generated-benchmark-v4') {
        if (typeof item.responseText !== 'string' || !item.responseText.trim()) fail('respuesta generada vacía')
        const seen = new Set()
        for (const claim of asArray(item.claims, 'generated claims')) {
          if (!claim.claimId || seen.has(claim.claimId) || !claim.text?.trim()) fail('afirmación generada inválida')
          seen.add(claim.claimId)
          assertSubset(claim.citedIds, benchmark.ids, 'generated citedIds')
        }
        continue
      }
      const claims = exactClaimCoverage(item.claims, new Set(referenceClaims.keys()), `claims ${item.queryId}`)
      for (const claim of claims) {
        if (Object.hasOwn(claim, 'supportedIds') || Object.hasOwn(claim, 'validIds')) fail('las citas no pueden traer etiquetas de respaldo propias')
        const referenceClaim = referenceClaims.get(claim.claimId)
        if (typeof claim.text !== 'string' || claim.text !== referenceClaim.text) fail(`claims ${item.queryId} contiene texto no vinculado a la referencia`)
        const citedIds = uniqueStrings(claim.citedIds, `${item.queryId}.${claim.claimId}.citedIds`, { allowEmpty: false })
        if (citedIds.some((id) => !benchmark.ids.has(id))) fail('una cita apunta fuera del corpus')
      }
    }
  }
  return { ...benchmark, retrieval, citations: citationSets, matrix }
}

function recallFor(retrieval, reference, dimensions, matrix) {
  const byQuery = new Map(retrieval.map((item) => [item.queryId, item]))
  let total = 0
  for (const query of reference.queries) {
    const item = byQuery.get(query.queryId)
    const vector = item.query ?? item.vector
    const top = matrix.map((document) => ({ id: document.id, score: cosine(vector, document.vector, dimensions) })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 5)
    total += top.filter((document) => query.relevantChunkIds.includes(document.id)).length / query.relevantChunkIds.length
  }
  return total / reference.queries.length
}

function precisionFor(citations, reference) {
  const byQuery = new Map(citations.map((item) => [item.queryId, item]))
  let cited = 0
  let supported = 0
  for (const query of reference.queries) {
    const claims = new Map(query.claims.map((claim) => [claim.claimId, claim]))
    for (const claim of byQuery.get(query.queryId).claims) {
      const label = claims.get(claim.claimId)
      for (const id of claim.citedIds) { cited += 1; if (label.supportedChunkIds.includes(id)) supported += 1 }
    }
  }
  return cited ? supported / cited : 0
}

export function responseFingerprint(item, dimensions, corpusVersion, benchmarkVersion) {
  return sha256Base64url(canonicalJson({ item, dimensions, corpusVersion, benchmarkVersion }))
}

function generatedPrecision(results, citations, dimensions) {
  let cited = 0, supported = 0
  const blockers = []
  for (const item of citations) {
    const hash = responseFingerprint(item, dimensions, results.corpusVersion, results.benchmarkVersion)
    const reviews = (results.reviews ?? []).filter(r => r.responseFingerprint === hash && r.dimensions === dimensions && r.queryId === item.queryId)
    const review = reviews.length === 1 ? reviews[0] : undefined
    if (item.providerKind !== 'remote' || !review?.reviewer?.trim() || !review?.notes?.trim() || !['allNewClaimsReviewed','contextFaithful','sportsCoherent','applicable','uncertaintyHandled'].every(key => review[key] === true)) {
      blockers.push(`${dimensions}:${item.queryId}: falta respuesta real y revisión completa ligada a su huella`)
      continue
    }
    if (!Array.isArray(review.claims) || review.claims.length !== item.claims.length || new Set(review.claims.map(c => c.claimId)).size !== item.claims.length || review.claims.some(c => !item.claims.some(i => i.claimId === c.claimId))) {
      blockers.push(`${dimensions}:${item.queryId}: revisión incompleta de afirmaciones nuevas`)
      continue
    }
    for (const claim of item.claims) {
      const label = review.claims.find(c => c.claimId === claim.claimId)
      uniqueStrings(label.supportedChunkIds, 'review supportedChunkIds')
      if (!claim.citedIds.length) blockers.push(`${dimensions}:${item.queryId}:${claim.claimId}: afirmación sin cita`)
      for (const id of claim.citedIds) { cited++; if (label.supportedChunkIds.includes(id)) supported++ }
    }
  }
  return { precision: cited ? supported / cited : 0, blockers }
}

export function evaluateBenchmark(reference, manifest, results) {
  const validated = validateEvaluationResults(results, reference, manifest)
  const vectorRecall512 = recallFor(validated.retrieval, reference, 512, validated.matrix)
  const vectorRecall1024 = recallFor(validated.retrieval, reference, 1024, validated.matrix)
  const generated = results.schema === 'generated-benchmark-v1' || results.schema === 'generated-benchmark-v2' || results.schema === 'generated-benchmark-v3' || results.schema === 'generated-benchmark-v4'
  const currentGeneratedIdentity = results.schema === 'generated-benchmark-v4' && results.responseSchemaVersion === 4
  const evidenceIdentity = currentGeneratedIdentity ? 'current-generated' : generated ? 'legacy-generated' : 'retrieval-only'
  const expanded = generated && results.retrievalPolicy === SUMMARY_RETRIEVAL_POLICY
  const recall512 = expanded ? evaluateContextRecallAt5(validated.citations[512], reference, manifest) : vectorRecall512
  const recall1024 = expanded ? evaluateContextRecallAt5(validated.citations[1024], reference, manifest) : vectorRecall1024
  const review512 = generated ? generatedPrecision(results, validated.citations[512], 512) : null
  const review1024 = generated ? generatedPrecision(results, validated.citations[1024], 1024) : null
  const generationBlockers = [...(review512?.blockers ?? []), ...(review1024?.blockers ?? [])]
  const citationPrecision512 = review512?.precision ?? precisionFor(validated.citations[512], reference)
  const citationPrecision1024 = review1024?.precision ?? precisionFor(validated.citations[1024], reference)
  const baseGate = (!generated || currentGeneratedIdentity) && generationBlockers.length === 0 && validated.ready && reference.status === 'approved' && recall512 >= 0.8 && citationPrecision512 >= 0.9
  const dimensionGate1024 = baseGate && recall1024 - recall512 >= 0.03 && citationPrecision1024 >= citationPrecision512
  return {
    benchmarkVersion: reference.version,
    corpusVersion: manifest.corpusVersion,
    queries: reference.queries.length,
    coverageComplete: true,
    recallAt5: { 512: recall512, 1024: recall1024 },
    retrievalMetric: expanded ? 'delivered-context-at-5' : 'vector-at-5',
    vectorRecallAt5: { 512: vectorRecall512, 1024: vectorRecall1024 },
    citationPrecision: { 512: citationPrecision512, 1024: citationPrecision1024 },
    evidenceIdentity,
    currentGeneratedIdentity,
    baseGate,
    dimensionGate1024,
    fingerprints: { manifest: sha256Base64url(canonicalJson(manifest)), reference: sha256Base64url(canonicalJson(reference)), results: sha256Base64url(canonicalJson(results)) },
    generationBlockers,
    retrievalGate: recall512 >= 0.8,
    generationGate: currentGeneratedIdentity && generationBlockers.length === 0 && citationPrecision512 >= 0.9,
    errors: generationBlockers,
  }
}

// Compatibilidad para utilidades/tests que todavía trabajan con fixtures
// sintéticos. Estos helpers no participan en un gate aprobable.
export function evaluateRecallAt5(fixtures, dimensions) {
  if (!fixtures.length) return 0
  const evaluated = fixtures.filter((fixture) => fixture.relevantIds.length > 0)
  return evaluated.length ? evaluated.reduce((total, fixture) => {
    const top = fixture.documents.map((document) => ({ id: document.id, score: cosine(fixture.query, document.vector, Math.min(dimensions, fixture.query.length, document.vector.length)) })).sort((a, b) => b.score - a.score).slice(0, 5)
    return total + top.filter((item) => fixture.relevantIds.includes(item.id)).length / new Set(fixture.relevantIds).size
  }, 0) / evaluated.length : 0
}

export function evaluateCitationPrecision(fixtures) {
  if (!fixtures.length) return 0
  const claims = fixtures.flatMap((fixture) => fixture.claims ?? [])
  if (claims.length) {
    const cited = claims.flatMap((claim) => claim.citedIds)
    if (!cited.length || claims.some((claim) => claim.citedIds.length === 0)) return 0
    return claims.reduce((total, claim) => total + claim.citedIds.filter((id) => claim.supportedIds.includes(id)).length, 0) / cited.length
  }
  const cited = fixtures.flatMap((fixture) => fixture.citedIds)
  if (!cited.length || fixtures.some((fixture) => fixture.citedIds.length === 0)) return 0
  return fixtures.reduce((total, fixture) => total + fixture.citedIds.filter((id) => fixture.validIds.includes(id)).length, 0) / cited.length
}

export function passesEvaluationGate(fixtures, citationFixtures, dimensions) {
  return evaluateRecallAt5(fixtures, dimensions) >= 0.8 && evaluateCitationPrecision(citationFixtures) >= 0.9
}

export function passesDimensionGate(fixtures, citationPrecision512, citationPrecision1024) {
  const recall512 = evaluateRecallAt5(fixtures, 512)
  const recall1024 = evaluateRecallAt5(fixtures, 1024)
  return recall1024 - recall512 >= 0.03 && citationPrecision1024 >= citationPrecision512
}

export const SYNTHETIC_FIXTURES = [
  { query: [1, 0, 0, 0], relevantIds: ['safety'], documents: [{ id: 'safety', vector: [1, 0, 0, 0] }, { id: 'noise', vector: [0, 1, 0, 0] }] },
  { query: [0, 1, 0, 0], relevantIds: ['progression'], documents: [{ id: 'progression', vector: [0, 1, 0, 0] }, { id: 'noise-2', vector: [0, 0, 1, 0] }] },
]
