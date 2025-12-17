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
