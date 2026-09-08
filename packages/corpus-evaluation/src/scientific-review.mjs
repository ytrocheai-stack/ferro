export const SCIENTIFIC_QUERY_COUNT = 50

/**
 * Structural benchmark validation is intentionally separate from scientific
 * approval: a frozen draft may be bound and inspected before a responsible
 * reviewer certifies it. Provider calls and release creation require every
 * assertion below.
 */
export function scientificReviewReady(reference) {
  const review = reference?.scientificReview
  if (!review || review.approved !== true || typeof review.reviewer !== 'string' || !review.reviewer.trim() || typeof review.notes !== 'string' || !review.notes.trim() || review.queryCount !== SCIENTIFIC_QUERY_COUNT) return false
  if (review.relevantReviewed !== true || review.hardNegativesReviewed !== true || review.claimsReviewed !== true || review.populationApplicabilityReviewed !== true || review.exclusionsCertified !== true) return false
  const reviewedAt = Date.parse(review.reviewedAt ?? '')
  return Number.isFinite(reviewedAt) && reviewedAt >= 0
}
