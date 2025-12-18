/**
 * Storage type definitions for EchoRoom
 *
 * Version 2 introduces multi-modal sample capture:
 * - Chirp-based acoustic fingerprinting (original)
 * - Ambient audio fingerprinting (new)
 * - Device orientation (new)
 */

// Capture modes for multi-modal classification
export type CaptureMode = 'chirp' | 'ambient-manual' | 'ambient-continuous';

export interface Room {
  id: string;
  name: string;
  icon?: string;       // Emoji or icon name
  color?: string;      // Hex color for UI
  createdAt: number;   // Unix timestamp
  updatedAt: number;   // Unix timestamp
}

// Structured features for multi-modal samples
export interface SampleFeatures {
  mode: CaptureMode;
  chirpFeatures?: number[];     // Chirp-based features (~60 values)
  ambientFeatures?: number[];   // Ambient audio features (~73 values)
  orientation?: [number, number, number];  // [alpha, beta, gamma] normalized
  raw?: number[];               // Legacy: flat array for backward compat
}

export interface Sample {
  id: string;
  roomId: string;      // Foreign key to Room
  features: SampleFeatures;  // Structured multi-modal features (v2)
  metadata: SampleMetadata;
  capturedAt: number;  // Unix timestamp
}

// Legacy sample format for v1 compatibility
export interface LegacySample {
  id: string;
  roomId: string;
  features: number[];  // Flat array (v1 format)
  metadata: LegacySampleMetadata;
  capturedAt: number;
}

export interface LegacySampleMetadata {
  chirpMode: 'audible' | 'ultrasonic';
  duration: number;
  sampleRate: number;
  deviceInfo?: string;
}

export interface SampleMetadata {
  captureMode: CaptureMode;       // Type of capture
  chirpMode?: 'audible' | 'ultrasonic';  // For chirp captures
  duration: number;               // Duration in ms
  sampleRate: number;             // Audio sample rate
  deviceInfo?: string;            // Device identifier
  hasOrientation: boolean;        // Whether orientation was captured
}

// Model type discriminator
export type ModelType = 'single' | 'multimodal';

export interface StoredModel {
  id: 'current';       // Fixed key - only one model at a time
  modelType: ModelType; // 'single' (v1) or 'multimodal' (v2)

  // Single-mode model (legacy, for backward compat)
  topology?: object;    // TensorFlow.js model JSON
  weights?: ArrayBuffer; // Serialized model weights
  normalizer?: FeatureNormalizer;

  // Multi-modal model components
  chirpEncoderTopology?: object;
  chirpEncoderWeights?: ArrayBuffer;
  ambientEncoderTopology?: object;
  ambientEncoderWeights?: ArrayBuffer;
  classifierTopology?: object;
  classifierWeights?: ArrayBuffer;

  // Multi-modal normalizers
  chirpNormalizer?: FeatureNormalizer;
  ambientNormalizer?: FeatureNormalizer;

  // Common fields
  roomLabels: string[]; // Room ID to class index mapping
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
// v1: Original chirp-only samples with flat feature array
// v2: Multi-modal samples with structured features + orientation
export const DB_VERSION = 2;
export const DB_NAME = 'echoroom-db';

// Store names
export const STORES = {
  ROOMS: 'rooms',
  SAMPLES: 'samples',
  MODEL: 'model',
} as const;
