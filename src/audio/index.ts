/**
 * Audio module public API
 */

// Types
export type {
  ChirpMode,
  ChirpConfig,
  CaptureConfig,
  AudioCaptureResult,
  ImpulseResponse,
  FeatureVector,
  AudioEngineState,
  AudioEngineCallbacks,
  AudioContextState,
} from './types';

export {
  CHIRP_PRESETS,
  DEFAULT_CAPTURE_CONFIG,
  FEATURE_VECTOR_LENGTH,
} from './types';

// Chirp generation
export {
  generateChirp,
  generateChirpPreset,
  getChirpConfig,
  createChirpBuffer,
  playChirp,
  generateInverseFilter,
  estimateIRDuration,
} from './ChirpGenerator';

// Audio capture
export {
  getAudioContext,
  closeAudioContext,
  requestMicrophonePermission,
  hasMicrophonePermission,
  recordAudio,
  captureRoomResponse,
  capturePassive,
  createLevelMeter,
} from './AudioCapture';

// Impulse response extraction
export {
  extractImpulseResponse,
  schroederIntegration,
  schroederToDb,
  findDecayTime,
  estimateRT60,
  estimateEDT,
} from './ImpulseResponseExtractor';

// Feature extraction
export {
  extractFeatures,
  extractFeaturesFromCapture,
} from './FeatureExtractor';

// DSP utilities (for advanced usage)
export {
  nextPowerOf2,
  zeroPad,
  hannWindow,
  hammingWindow,
  applyWindow,
  fft,
  ifft,
  rfft,
  irfft,
  powerSpectrum,
  linearToDb,
  dbToLinear,
  rms,
  normalize,
  melFilterbank,
  dct,
  frameSignal,
  mean,
  variance,
  std,
} from './utils';
