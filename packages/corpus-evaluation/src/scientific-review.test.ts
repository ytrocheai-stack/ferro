import { describe, expect, it } from 'vitest'
import { scientificReviewReady } from './scientific-review.mjs'

const approved = {
  scientificReview: {
    approved: true,
    reviewer: 'responsible-reviewer',
    notes: 'Reviewed labels, applicability, and exclusions against the frozen source excerpts.',
    queryCount: 50,
    relevantReviewed: true,
    hardNegativesReviewed: true,
    claimsReviewed: true,
    populationApplicabilityReviewed: true,
    exclusionsCertified: true,
    reviewedAt: '2026-09-05T12:00:00.000Z',
  },
}

describe('scientific review approval contract', () => {
  it('requires every scientific review dimension before provider execution', () => {
    expect(scientificReviewReady(approved)).toBe(true)
    expect(scientificReviewReady({ ...approved, scientificReview: { ...approved.scientificReview, hardNegativesReviewed: false } })).toBe(false)
    expect(scientificReviewReady({ ...approved, scientificReview: { ...approved.scientificReview, reviewedAt: '' } })).toBe(false)
  })
})
