/**
 * AudioCapture - Handles microphone access and audio recording
 *
 * Uses Web Audio API for precise timing and synchronization
 * with chirp playback for acoustic measurement.
 */

import {
  ChirpMode,
  CaptureConfig,
  DEFAULT_CAPTURE_CONFIG,
  AudioCaptureResult,
  AmbientCaptureResult,
} from './types';
import { getChirpConfig, playChirp } from './ChirpGenerator';
import {
  getCurrentOrientation,
  hasOrientationSupport,
  isSecureContext,
} from './OrientationCapture';

// Singleton audio context to avoid creating multiple instances
let audioContext: AudioContext | null = null;

/**
 * Get or create the audio context
 * Handles the suspended state that occurs before user interaction
 */
export async function getAudioContext(): Promise<AudioContext> {
  if (!audioContext) {
    audioContext = new AudioContext({ sampleRate: 48000 });
  }

  // Resume if suspended (required on iOS and some browsers)
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  return audioContext;
}

/**
 * Close the audio context and release resources
 */
export function closeAudioContext(): void {
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
}

/**
 * Request microphone permission
 * Returns the MediaStream if granted
 */
export async function requestMicrophonePermission(): Promise<MediaStream> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,  // We want the raw audio with echoes
        noiseSuppression: false,  // Don't suppress room noise
        autoGainControl: false,   // Keep consistent gain
        sampleRate: 48000,
      },
    });
    return stream;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'NotAllowedError') {
        throw new Error('Microphone permission denied. Please allow microphone access to use this feature.');
      } else if (error.name === 'NotFoundError') {
        throw new Error('No microphone found. Please connect a microphone and try again.');
      }
    }
    throw error;
  }
}

/**
 * Check if microphone permission has been granted
 */
export async function hasMicrophonePermission(): Promise<boolean> {
  try {
    const result = await navigator.permissions.query({
      name: 'microphone' as PermissionName,
    });
    return result.state === 'granted';
  } catch {
    // Permissions API not supported, try requesting access
    try {
      const stream = await requestMicrophonePermission();
      stream.getTracks().forEach((track) => track.stop());
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Record audio from the microphone for a specified duration
 */
export async function recordAudio(
  stream: MediaStream,
  durationSeconds: number,
  sampleRate: number
): Promise<Float32Array> {
  const context = await getAudioContext();
  const source = context.createMediaStreamSource(stream);

  // Create a buffer to store recorded samples
  const bufferSize = Math.ceil(durationSeconds * sampleRate);
  const recordedSamples = new Float32Array(bufferSize);
  let samplesRecorded = 0;

  // Use ScriptProcessorNode for recording (AudioWorklet would be better but more complex)
  // Note: ScriptProcessorNode is deprecated but still widely supported
  const processorBufferSize = 4096;
  const processor = context.createScriptProcessor(processorBufferSize, 1, 1);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve(recordedSamples);
    }, durationSeconds * 1000 + 100); // Small buffer for timing

    processor.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0);
      const remaining = bufferSize - samplesRecorded;

      if (remaining <= 0) {
        cleanup();
        resolve(recordedSamples);
        return;
      }

      const samplesToWrite = Math.min(inputData.length, remaining);
      recordedSamples.set(inputData.subarray(0, samplesToWrite), samplesRecorded);
      samplesRecorded += samplesToWrite;
    };

    function cleanup() {
      clearTimeout(timeout);
      processor.disconnect();
      source.disconnect();
    }

    source.connect(processor);
    processor.connect(context.destination); // Required for processing to work
  });
}

/**
 * Capture audio by playing a chirp and recording the room response
 * This is the main function for acoustic measurement
 *
 * @param mode - Chirp mode (audible or ultrasonic)
 * @param config - Capture configuration
 * @param volume - Playback volume (0-1)
 * @param includeOrientation - Whether to capture device orientation
 */
export async function captureRoomResponse(
  mode: ChirpMode,
  config: CaptureConfig = DEFAULT_CAPTURE_CONFIG,
  volume: number = 0.8,
  includeOrientation: boolean = true
): Promise<AudioCaptureResult> {
  console.log('[AudioCapture] Starting capture, mode:', mode, 'orientation:', includeOrientation);

  // Get audio context and ensure it's running
  console.log('[AudioCapture] Getting audio context...');
  const context = await getAudioContext();
  console.log('[AudioCapture] Audio context ready, state:', context.state, 'sampleRate:', context.sampleRate);

  // Request microphone access
  console.log('[AudioCapture] Requesting microphone permission...');
  const stream = await requestMicrophonePermission();
  console.log('[AudioCapture] Microphone stream obtained');

  try {
    // Get chirp configuration
    const chirpConfig = getChirpConfig(mode, context.sampleRate);
    console.log('[AudioCapture] Chirp config:', chirpConfig);

    // Calculate capture duration
    // Total = pre-delay + chirp duration + reverb tail
    const chirpDuration = chirpConfig.duration;
    const reverbTail = 1.5; // 1.5 seconds for reverb to decay
    const totalDuration = config.preDelay + chirpDuration + reverbTail;
    console.log('[AudioCapture] Total recording duration:', totalDuration, 'seconds');

    // Start recording
    console.log('[AudioCapture] Starting recording...');
    const recordingPromise = recordAudio(stream, totalDuration, context.sampleRate);

    // Wait for pre-delay, then play chirp
    console.log('[AudioCapture] Waiting for pre-delay:', config.preDelay * 1000, 'ms');
    await sleep(config.preDelay * 1000);
    console.log('[AudioCapture] Playing chirp...');
    const chirpSignal = await playChirp(context, mode, volume);
    console.log('[AudioCapture] Chirp played, waiting for recording to complete...');

    // Wait for recording to complete
    const captured = await recordingPromise;
    console.log('[AudioCapture] Recording complete, samples:', captured.length);

    // Capture device orientation if requested
    let orientation = undefined;
    if (includeOrientation && hasOrientationSupport() && isSecureContext()) {
      orientation = await getCurrentOrientation();
      console.log('[AudioCapture] Orientation captured:', orientation);
    }

    return {
      captured,
      chirp: chirpSignal,
      sampleRate: context.sampleRate,
      config: chirpConfig,
      timestamp: Date.now(),
      orientation,
    };
  } finally {
    // Stop all tracks to release the microphone
    console.log('[AudioCapture] Releasing microphone...');
    stream.getTracks().forEach((track) => track.stop());
  }
}

/**
 * Capture audio in passive mode (no chirp, just background noise)
 * Useful for ambient acoustic fingerprinting
 *
 * @param durationSeconds - Recording duration in seconds
 * @param includeOrientation - Whether to capture device orientation
 */
export async function capturePassive(
  durationSeconds: number = 3,
  includeOrientation: boolean = true
): Promise<AmbientCaptureResult> {
  console.log('[AudioCapture] Starting passive capture, duration:', durationSeconds, 'orientation:', includeOrientation);

  const context = await getAudioContext();
  const stream = await requestMicrophonePermission();

  try {
    const audio = await recordAudio(stream, durationSeconds, context.sampleRate);
    console.log('[AudioCapture] Passive recording complete, samples:', audio.length);

    // Capture device orientation if requested
    let orientation = undefined;
    if (includeOrientation && hasOrientationSupport() && isSecureContext()) {
      orientation = await getCurrentOrientation();
      console.log('[AudioCapture] Orientation captured:', orientation);
    }

    return {
      audio,
      sampleRate: context.sampleRate,
      duration: durationSeconds,
      timestamp: Date.now(),
      orientation,
    };
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}

/**
 * Get real-time audio level (for UI feedback)
 */
export async function createLevelMeter(
  stream: MediaStream,
  callback: (level: number) => void
): Promise<() => void> {
  const context = await getAudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();

  analyser.fftSize = 256;
  source.connect(analyser);

  const dataArray = new Float32Array(analyser.fftSize);
  let animationId: number;

  function update() {
    analyser.getFloatTimeDomainData(dataArray);

    // Calculate RMS level
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i] * dataArray[i];
    }
    const rms = Math.sqrt(sum / dataArray.length);

    // Convert to a 0-1 range (approximate)
    const level = Math.min(1, rms * 5);
    callback(level);

    animationId = requestAnimationFrame(update);
  }

  update();

  // Return cleanup function
  return () => {
    cancelAnimationFrame(animationId);
    source.disconnect();
    analyser.disconnect();
  };
}

/**
 * Helper: sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
