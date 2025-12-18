/**
 * Audio module public API
 */

// Types
export type {
  ChirpMode,
  CaptureMode,
  ChirpConfig,
  CaptureConfig,
  AudioCaptureResult,
  AmbientCaptureResult,
  ImpulseResponse,
  FeatureVector,
  AmbientFeatureVector,
  AudioEngineState,
  AudioEngineCallbacks,
  AudioContextState,
  // Orientation-aware feature types
  OrientationAwareFeatures,
  LateReverbFeatures,
  EarlyReflectionFeatures,
  FeatureMetadata,
} from './types';

export {
  CHIRP_PRESETS,
  DEFAULT_CAPTURE_CONFIG,
  FEATURE_VECTOR_LENGTH,
  CHIRP_FEATURE_LENGTH,
  AMBIENT_FEATURE_LENGTH,
  AMBIENT_FEATURE_WITH_ORIENTATION_LENGTH,
  // Orientation-aware feature constants
  MIXING_TIME_MS,
  LATE_REVERB_FEATURE_LENGTH,
  EARLY_REFLECTION_FEATURE_LENGTH,
  EXTENDED_FEATURE_VECTOR_LENGTH,
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
  // Orientation-aware feature extraction
  extractOrientationAwareFeatures,
  convertToOrientationAwareFeatures,
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
  percentile,
  detectPeaksAtFrequencies,
  autocorrelation,
  octaveBandEnergies,
} from './utils';

// Ambient feature extraction
export {
  extractAmbientFeatures,
  extractAmbientFeaturesFromCapture,
} from './AmbientFeatureExtractor';

// Orientation capture
export type { DeviceOrientation } from './OrientationCapture';
export {
  hasOrientationSupport,
  isSecureContext,
  startOrientationListener,
  stopOrientationListener,
  getCurrentOrientation,
  normalizeOrientation,
  normalizeOrientationCircular,
  hasValidOrientation,
  getOrientationStatus,
} from './OrientationCapture';

// Background recording
export type {
  BackgroundRecorderConfig,
  BackgroundRecorderCallbacks,
  BackgroundRecorderStatus,
} from './BackgroundRecorder';
export {
  BackgroundRecorder,
  DEFAULT_BACKGROUND_CONFIG,
  isContinuousRecordingSupported,
} from './BackgroundRecorder';
