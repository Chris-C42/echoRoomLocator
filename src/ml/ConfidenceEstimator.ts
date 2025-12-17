/**
 * ConfidenceEstimator - Compute confidence metrics for predictions
 *
 * Provides multiple measures of prediction confidence:
 * - Top probability (softmax output)
 * - Entropy (uncertainty measure)
 * - Margin (difference between top 2 probabilities)
 */

import { ConfidenceMetrics, CONFIDENCE_THRESHOLDS } from './types';

/**
 * Compute the entropy of a probability distribution
 * Higher entropy = more uncertainty
 */
export function computeEntropy(probabilities: number[]): number {
  let entropy = 0;
  for (const p of probabilities) {
    if (p > 1e-10) {
      entropy -= p * Math.log2(p);
    }
  }
  return entropy;
}

/**
 * Compute the margin between top 2 probabilities
 * Lower margin = more ambiguous prediction
 */
export function computeMargin(probabilities: number[]): number {
  if (probabilities.length < 2) {
    return 1.0;
  }

  // Sort probabilities descending
  const sorted = [...probabilities].sort((a, b) => b - a);
  return sorted[0] - sorted[1];
}

/**
 * Compute all confidence metrics for a prediction
 */
export function computeConfidenceMetrics(probabilities: number[]): ConfidenceMetrics {
  const topProbability = Math.max(...probabilities);
  const entropy = computeEntropy(probabilities);
  const margin = computeMargin(probabilities);

  // Determine if this is a low confidence prediction
  const isLowConfidence =
    topProbability < CONFIDENCE_THRESHOLDS.LOW_CONFIDENCE_PROBABILITY ||
    entropy > CONFIDENCE_THRESHOLDS.HIGH_ENTROPY_THRESHOLD ||
    margin < CONFIDENCE_THRESHOLDS.MIN_MARGIN_THRESHOLD;

  return {
    topProbability,
    entropy,
    margin,
    isLowConfidence,
  };
}

/**
 * Get a human-readable confidence level
 */
export function getConfidenceLevel(
  confidence: number
): 'high' | 'medium' | 'low' {
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.6) return 'medium';
  return 'low';
}

/**
 * Get confidence color for UI display
 */
export function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.8) return '#10b981'; // Green
  if (confidence >= 0.6) return '#f59e0b'; // Yellow
  return '#ef4444'; // Red
}

/**
 * Format confidence as percentage string
 */
export function formatConfidence(confidence: number): string {
  return `${(confidence * 100).toFixed(0)}%`;
}

/**
 * Compute the maximum entropy for a given number of classes
 * (uniform distribution has maximum entropy)
 */
export function maxEntropy(numClasses: number): number {
  return Math.log2(numClasses);
}

/**
 * Compute normalized entropy (0 = certain, 1 = maximum uncertainty)
 */
export function normalizedEntropy(
  probabilities: number[],
  numClasses: number
): number {
  const entropy = computeEntropy(probabilities);
  const max = maxEntropy(numClasses);
  return max > 0 ? entropy / max : 0;
}

/**
 * Determine if a prediction should be flagged for user review
 * based on multiple confidence indicators
 */
export function shouldFlagForReview(metrics: ConfidenceMetrics): boolean {
  // Flag if any indicator suggests low confidence
  return metrics.isLowConfidence;
}

/**
 * Get suggested action based on confidence
 */
export function getSuggestedAction(
  metrics: ConfidenceMetrics
): 'accept' | 'review' | 'reject' {
  if (metrics.topProbability >= 0.8 && metrics.margin >= 0.3) {
    return 'accept';
  }
  if (metrics.topProbability >= 0.5 && !metrics.isLowConfidence) {
    return 'review';
  }
  return 'reject';
}
