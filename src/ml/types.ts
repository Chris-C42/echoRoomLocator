/**
 * ML module type definitions
 */

import * as tf from '@tensorflow/tfjs';

export interface ModelConfig {
  inputSize: number;           // Feature vector length (~60)
  hiddenLayers: number[];      // Hidden layer sizes [128, 64, 32]
  numClasses: number;          // Max 20 rooms
  dropoutRates: number[];      // Dropout for each hidden layer [0.3, 0.2, 0]
  learningRate: number;        // Adam optimizer learning rate
}

export const DEFAULT_MODEL_CONFIG: Omit<ModelConfig, 'numClasses'> = {
  inputSize: 60,
  hiddenLayers: [128, 64, 32],
  dropoutRates: [0.3, 0.2, 0],
  learningRate: 0.001,
};

export interface TrainingConfig {
  epochs: number;
  batchSize: number;
  validationSplit: number;
  earlyStopping: {
    patience: number;
    minDelta: number;
  };
  classWeights: boolean;       // Auto-compute class weights for imbalanced data
  augmentation: {
    enabled: boolean;
    noiseStd: number;          // Gaussian noise standard deviation
  };
  // Feature weighting for orientation robustness (A4)
  featureWeighting: {
    enabled: boolean;
    lateReverbWeight: number;      // Weight for late reverb features (indices 0-19)
    earlyReflectionWeight: number; // Weight for early reflection features (indices 20+)
    lateFeatureCount: number;      // Number of late reverb features (default 20)
  };
  // Orientation diversity enforcement (B4)
  orientationDiversity: {
    enforced: boolean;             // Whether to block training when diversity is low
    minDiversityScore: number;     // Minimum diversity score (0-1, default 0.4)
    minCoverage: number;           // Minimum coverage (0-1, default 0.5)
  };
}

export const DEFAULT_TRAINING_CONFIG: TrainingConfig = {
  epochs: 100,
  batchSize: 32,
  validationSplit: 0.2,
  earlyStopping: {
    patience: 10,
    minDelta: 0.001,
  },
  classWeights: true,
  augmentation: {
    enabled: true,
    noiseStd: 0.05,
  },
  // A4: Feature weighting - emphasize late reverb (orientation-invariant)
  featureWeighting: {
    enabled: true,
    lateReverbWeight: 2.0,        // 2x weight on late reverb features
    earlyReflectionWeight: 0.5,   // 0.5x weight on early reflection features
    lateFeatureCount: 20,         // First 20 features are late reverb
  },
  // B4: Orientation diversity enforcement
  orientationDiversity: {
    enforced: true,               // Block training when diversity is low
    minDiversityScore: 0.4,       // Minimum entropy-based diversity
    minCoverage: 0.5,             // Minimum orientation coverage
  },
};

export interface TrainingProgress {
  epoch: number;
  totalEpochs: number;
  loss: number;
  accuracy: number;
  valLoss?: number;
  valAccuracy?: number;
  phase: 'preparing' | 'training' | 'validating' | 'complete' | 'error';
  message?: string;
}

export interface TrainingResult {
  success: boolean;
  finalAccuracy: number;
  finalLoss: number;
  epochs: number;
  history: {
    loss: number[];
    accuracy: number[];
    valLoss: number[];
    valAccuracy: number[];
  };
  error?: string;
}

export interface PredictionResult {
  predictedRoomId: string;
  confidence: number;
  allProbabilities: Map<string, number>;
  isLowConfidence: boolean;
  entropy: number;
}

export interface ConfidenceMetrics {
  topProbability: number;      // Softmax probability of top class
  entropy: number;             // Entropy of probability distribution
  margin: number;              // Difference between top 2 probabilities
  isLowConfidence: boolean;    // Flag for uncertain predictions
}

export interface NormalizerParams {
  mean: number[];
  std: number[];
  featureCount: number;
}

// Confidence thresholds
export const CONFIDENCE_THRESHOLDS = {
  LOW_CONFIDENCE_PROBABILITY: 0.6,    // Below this = low confidence
  HIGH_ENTROPY_THRESHOLD: 1.0,        // Above this = high uncertainty
  MIN_MARGIN_THRESHOLD: 0.2,          // Below this = ambiguous prediction
} as const;

// Type for TensorFlow model
export type RoomClassifierModel = tf.LayersModel;

// Callback types
export type TrainingProgressCallback = (progress: TrainingProgress) => void;
export type TrainingCompleteCallback = (result: TrainingResult) => void;

// ============================================
// Multi-Modal Model Configuration
// ============================================

export type EncoderType = 'chirp' | 'ambient';

export interface MultiModalModelConfig {
  // Feature sizes (including orientation as quaternion [w,x,y,z])
  chirpInputSize: number;      // Chirp features (60) + orientation (4) = 64
  ambientInputSize: number;    // Ambient features (73) + orientation (4) = 77

  // Encoder architectures
  chirpEncoderLayers: number[];   // e.g., [128, 64]
  ambientEncoderLayers: number[]; // e.g., [128, 64]

  // Shared embedding dimension
  embeddingSize: number;          // e.g., 32

  // Classifier layers after embedding
  classifierLayers: number[];     // e.g., [64, 32]
  dropoutRates: number[];         // Dropout for each layer

  numClasses: number;
  learningRate: number;
}

export const DEFAULT_MULTIMODAL_CONFIG: Omit<MultiModalModelConfig, 'numClasses'> = {
  chirpInputSize: 64,    // 60 chirp + 4 orientation (quaternion)
  ambientInputSize: 77,  // 73 ambient + 4 orientation (quaternion)
  chirpEncoderLayers: [128, 64],
  ambientEncoderLayers: [128, 64],
  embeddingSize: 32,
  classifierLayers: [64, 32],
  dropoutRates: [0.3, 0.2, 0],
  learningRate: 0.001,
};

export interface MultiModalTrainingConfig extends TrainingConfig {
  // Additional multi-modal settings
  balanceModalities: boolean;  // Balance chirp and ambient samples
  modalityWeights: {
    chirp: number;             // Weight for chirp samples
    ambient: number;           // Weight for ambient samples
  };
}

export const DEFAULT_MULTIMODAL_TRAINING_CONFIG: MultiModalTrainingConfig = {
  ...DEFAULT_TRAINING_CONFIG,
  balanceModalities: true,
  modalityWeights: {
    chirp: 1.0,
    ambient: 1.0,
  },
};

export interface MultiModalPredictionResult extends PredictionResult {
  encoderUsed: EncoderType;    // Which encoder was used
  embeddingVector?: number[];  // Optional: the 32-dim embedding
}

export interface MultiModalTrainingData {
  chirpFeatures: number[][];   // Chirp feature vectors
  chirpLabels: string[];       // Room labels for chirp samples
  ambientFeatures: number[][]; // Ambient feature vectors
  ambientLabels: string[];     // Room labels for ambient samples
  roomLabels: string[];        // Unique room IDs
}
