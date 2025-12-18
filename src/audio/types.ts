/**
 * Audio module type definitions
 */

// Re-export orientation types
export type { DeviceOrientation } from './OrientationCapture';

export type ChirpMode = 'audible' | 'ultrasonic';

// Capture modes for multi-modal classification
export type CaptureMode = 'chirp' | 'ambient-manual' | 'ambient-continuous';

export interface ChirpConfig {
  mode: ChirpMode;
  startFrequency: number;  // Hz
  endFrequency: number;    // Hz
  duration: number;        // seconds
  sampleRate: number;      // Hz
  fadeTime: number;        // seconds (fade in/out to prevent clicks)
}

export const CHIRP_PRESETS: Record<ChirpMode, Omit<ChirpConfig, 'sampleRate'>> = {
  audible: {
    mode: 'audible',
    startFrequency: 200,
    endFrequency: 18000,
    duration: 0.5,
    fadeTime: 0.01,
  },
  ultrasonic: {
    mode: 'ultrasonic',
    startFrequency: 15000,
    endFrequency: 20000,
    duration: 0.3,
    fadeTime: 0.005,
  },
};

export interface CaptureConfig {
  sampleRate: number;
  duration: number;        // Total capture duration (chirp + reverb tail)
  preDelay: number;        // Time before chirp playback starts
}

export const DEFAULT_CAPTURE_CONFIG: CaptureConfig = {
  sampleRate: 48000,
  duration: 2.0,           // 2 seconds total capture
  preDelay: 0.1,           // 100ms before chirp
};

export interface AudioCaptureResult {
  captured: Float32Array;  // Recorded audio
  chirp: Float32Array;     // Original chirp for deconvolution
  sampleRate: number;
  config: ChirpConfig;
  timestamp: number;
  orientation?: import('./OrientationCapture').DeviceOrientation;  // Device orientation at capture time
}

// Result from ambient (passive) audio capture
export interface AmbientCaptureResult {
  audio: Float32Array;     // Recorded ambient audio
  sampleRate: number;
  duration: number;        // Duration in seconds
  timestamp: number;
  orientation?: import('./OrientationCapture').DeviceOrientation;
}

export interface ImpulseResponse {
  data: Float32Array;      // Impulse response signal
  sampleRate: number;
  duration: number;        // Duration in seconds
}

export interface FeatureVector {
  // Reverberation characteristics
  rt60: number;            // Reverberation time (T60) in seconds
  edt: number;             // Early decay time in seconds

  // Clarity ratios
  c50: number;             // Clarity ratio (50ms)
  c80: number;             // Clarity ratio (80ms)

  // Spectral features
  spectralCentroid: number;
  spectralRolloff: number;
  spectralFlux: number;
  spectralFlatness: number;

  // MFCC coefficients (13 coefficients, mean and variance)
  mfccMean: number[];      // 13 values
  mfccVariance: number[];  // 13 values

  // Early reflection energy (8 time bins, 0-80ms in 10ms steps)
  earlyReflections: number[];

  // Octave band energy (125Hz, 250Hz, 500Hz, 1kHz, 2kHz, 4kHz, 8kHz)
  octaveBands: number[];

  // Raw feature array for ML input
  raw: number[];
}

// Feature vector length: 1 + 1 + 1 + 1 + 4 + 13 + 13 + 8 + 7 = ~49 base + more = ~60
export const FEATURE_VECTOR_LENGTH = 60;

// Chirp features with orientation: 60 + 3 = 63
export const CHIRP_FEATURE_LENGTH = 63;

// Ambient feature vector for passive audio recording
export interface AmbientFeatureVector {
  // Spectral features (temporal statistics)
  spectralCentroidMean: number;
  spectralCentroidStd: number;
  spectralRolloffMean: number;
  spectralRolloffStd: number;
  spectralFluxMean: number;
  spectralFluxStd: number;
  spectralFlatnessMean: number;
  spectralFlatnessStd: number;

  // MFCC features (13 coefficients each)
  mfccMean: number[];      // 13 values - mean across frames
  mfccVariance: number[];  // 13 values - variance across frames
  mfccDelta: number[];     // 13 values - rate of change

  // Noise floor characteristics
  rmsLevel: number;        // Overall RMS
  rmsPercentile10: number; // 10th percentile (quiet moments)
  rmsPercentile50: number; // 50th percentile (median)
  rmsPercentile90: number; // 90th percentile (loud moments)

  // Octave band energy (10 bands: 31Hz to 16kHz)
  octaveBands: number[];   // 10 values

  // Temporal variance
  powerVariance: number;   // Variance of power over time windows

  // HVAC/hum detection (peaks at power line harmonics)
  hvacPeaks: number[];     // 6 values: [50, 60, 100, 120, 150, 180] Hz

  // Background periodicity (autocorrelation peaks)
  autocorrelation: number[]; // 5 values - first 5 significant peaks

  // Raw feature array for ML input
  raw: number[];           // Compiled ~70 values
}

// Ambient feature length: 8 + 13 + 13 + 13 + 4 + 10 + 1 + 6 + 5 = 73
export const AMBIENT_FEATURE_LENGTH = 73;

// Ambient features with orientation: 73 + 3 = 76
export const AMBIENT_FEATURE_WITH_ORIENTATION_LENGTH = 76;

export interface AudioEngineState {
  isInitialized: boolean;
  isCapturing: boolean;
  isPlaying: boolean;
  hasPermission: boolean;
  error: string | null;
}

export interface AudioEngineCallbacks {
  onStateChange?: (state: AudioEngineState) => void;
  onCaptureComplete?: (result: AudioCaptureResult) => void;
  onError?: (error: Error) => void;
}

// Web Audio API related types
export interface AudioContextState {
  context: AudioContext | null;
  analyser: AnalyserNode | null;
  stream: MediaStream | null;
}
