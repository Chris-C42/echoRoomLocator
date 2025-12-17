/**
 * Storage type definitions for EchoRoom
 */

export interface Room {
  id: string;
  name: string;
  icon?: string;       // Emoji or icon name
  color?: string;      // Hex color for UI
  createdAt: number;   // Unix timestamp
  updatedAt: number;   // Unix timestamp
}

export interface Sample {
  id: string;
  roomId: string;      // Foreign key to Room
  features: number[];  // Feature vector (~60 values)
  metadata: SampleMetadata;
  capturedAt: number;  // Unix timestamp
}

export interface SampleMetadata {
  chirpMode: 'audible' | 'ultrasonic';
  duration: number;    // Chirp duration in ms
  sampleRate: number;  // Audio sample rate
  deviceInfo?: string; // Optional device identifier
}

export interface StoredModel {
  id: 'current';       // Fixed key - only one model at a time
  topology: object;    // TensorFlow.js model JSON
  weights: ArrayBuffer; // Serialized model weights
  roomLabels: string[]; // Room ID to class index mapping
  normalizer: FeatureNormalizer;
  metadata: ModelMetadata;
  createdAt: number;
}

export interface FeatureNormalizer {
  mean: number[];      // Mean for each feature
  std: number[];       // Standard deviation for each feature
  featureCount: number; // Number of features
}

export interface ModelMetadata {
  accuracy: number;    // Final validation accuracy
  loss: number;        // Final validation loss
  epochs: number;      // Number of epochs trained
  samplesUsed: number; // Total samples used for training
  roomCount: number;   // Number of rooms in model
}

export interface TrainingProgress {
  epoch: number;
  totalEpochs: number;
  loss: number;
  accuracy: number;
  valLoss?: number;
  valAccuracy?: number;
}

// Database schema version for migrations
export const DB_VERSION = 1;
export const DB_NAME = 'echoroom-db';

// Store names
export const STORES = {
  ROOMS: 'rooms',
  SAMPLES: 'samples',
  MODEL: 'model',
} as const;
