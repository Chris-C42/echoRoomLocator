/**
 * ML module public API
 */

// Types
export type {
  ModelConfig,
  TrainingConfig,
  TrainingProgress,
  TrainingResult,
  PredictionResult,
  ConfidenceMetrics,
  NormalizerParams,
  RoomClassifierModel,
  TrainingProgressCallback,
  TrainingCompleteCallback,
} from './types';

export {
  DEFAULT_MODEL_CONFIG,
  DEFAULT_TRAINING_CONFIG,
  CONFIDENCE_THRESHOLDS,
} from './types';

// Classes
export { FeatureNormalizer } from './FeatureNormalizer';
export { RoomClassifier } from './RoomClassifier';
export { ModelTrainer } from './ModelTrainer';

// Confidence utilities
export {
  computeEntropy,
  computeMargin,
  computeConfidenceMetrics,
  getConfidenceLevel,
  getConfidenceColor,
  formatConfidence,
  maxEntropy,
  normalizedEntropy,
  shouldFlagForReview,
  getSuggestedAction,
} from './ConfidenceEstimator';
