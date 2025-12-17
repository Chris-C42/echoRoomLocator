/**
 * ChirpGenerator - Generates logarithmic sine sweep chirps for acoustic measurement
 *
 * Two modes:
 * - Audible: 200 Hz - 18 kHz (higher accuracy, clearly audible)
 * - Ultrasonic: 15 kHz - 20 kHz (less audible, may have reduced accuracy)
 */

import { ChirpConfig, ChirpMode, CHIRP_PRESETS } from './types';

/**
 * Generate a logarithmic sine sweep (chirp) signal
 *
 * The frequency follows: f(t) = f_start * (f_end / f_start)^(t/T)
 * This provides constant energy per octave, which is ideal for room acoustics measurement.
 */
export function generateChirp(config: ChirpConfig): Float32Array {
  const {
    startFrequency,
    endFrequency,
    duration,
    sampleRate,
    fadeTime,
  } = config;

  const numSamples = Math.floor(duration * sampleRate);
  const signal = new Float32Array(numSamples);

  // Logarithmic sweep parameters
  const k = Math.log(endFrequency / startFrequency);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const tNorm = t / duration; // Normalized time [0, 1]

    // Instantaneous frequency: f(t) = f_start * e^(k * t/T)
    // Phase is integral of frequency: phi(t) = 2*pi * f_start * T/k * (e^(k*t/T) - 1)
    const phase =
      (2 * Math.PI * startFrequency * duration) / k *
      (Math.exp(k * tNorm) - 1);

    signal[i] = Math.sin(phase);
  }

  // Apply fade in/out envelope to prevent clicks
  applyFadeEnvelope(signal, sampleRate, fadeTime);

  return signal;
}

/**
 * Apply a smooth fade-in and fade-out envelope to prevent clicks
 * Uses a raised cosine (Hann) envelope for smooth transitions
 */
function applyFadeEnvelope(
  signal: Float32Array,
  sampleRate: number,
  fadeTime: number
): void {
  const fadeSamples = Math.floor(fadeTime * sampleRate);

  for (let i = 0; i < fadeSamples && i < signal.length; i++) {
    // Raised cosine fade-in
    const envelope = 0.5 * (1 - Math.cos((Math.PI * i) / fadeSamples));
    signal[i] *= envelope;
  }

  for (let i = 0; i < fadeSamples && i < signal.length; i++) {
    // Raised cosine fade-out
    const idx = signal.length - 1 - i;
    const envelope = 0.5 * (1 - Math.cos((Math.PI * i) / fadeSamples));
    signal[idx] *= envelope;
  }
}

/**
 * Generate a chirp using preset mode
 */
export function generateChirpPreset(
  mode: ChirpMode,
  sampleRate: number = 48000
): Float32Array {
  const preset = CHIRP_PRESETS[mode];
  return generateChirp({
    ...preset,
    sampleRate,
  });
}

/**
 * Get full chirp config for a preset mode
 */
export function getChirpConfig(
  mode: ChirpMode,
  sampleRate: number = 48000
): ChirpConfig {
  return {
    ...CHIRP_PRESETS[mode],
    sampleRate,
  };
}

/**
 * Create an AudioBuffer from a chirp signal for Web Audio API playback
 */
export function createChirpBuffer(
  context: AudioContext,
  mode: ChirpMode
): AudioBuffer {
  const config = getChirpConfig(mode, context.sampleRate);
  const signal = generateChirp(config);

  const buffer = context.createBuffer(1, signal.length, context.sampleRate);
  buffer.copyToChannel(new Float32Array(signal), 0);

  return buffer;
}

/**
 * Play a chirp through the audio context
 * Returns a promise that resolves when playback completes
 */
export function playChirp(
  context: AudioContext,
  mode: ChirpMode,
  volume: number = 0.8
): Promise<Float32Array> {
  return new Promise((resolve) => {
    const buffer = createChirpBuffer(context, mode);
    const source = context.createBufferSource();
    const gainNode = context.createGain();

    source.buffer = buffer;
    gainNode.gain.value = volume;

    source.connect(gainNode);
    gainNode.connect(context.destination);

    source.onended = () => {
      // Return the chirp signal for deconvolution
      const signal = new Float32Array(buffer.length);
      buffer.copyFromChannel(signal, 0);
      resolve(signal);
    };

    source.start();
  });
}

/**
 * Generate inverse filter for the chirp (used in deconvolution)
 * The inverse filter has time-reversed amplitude envelope
 */
export function generateInverseFilter(
  chirp: Float32Array,
  config: ChirpConfig
): Float32Array {
  const { startFrequency, endFrequency, duration } = config;

  // Time-reverse the chirp
  const inverse = new Float32Array(chirp.length);
  for (let i = 0; i < chirp.length; i++) {
    inverse[i] = chirp[chirp.length - 1 - i];
  }

  // Apply amplitude modulation to compensate for sweep rate
  // Higher frequencies are swept faster, so they need more gain
  const k = Math.log(endFrequency / startFrequency);

  for (let i = 0; i < inverse.length; i++) {
    const t = i / config.sampleRate;
    const tNorm = t / duration;

    // Amplitude envelope: proportional to 1/f(t)
    // This gives equal energy per octave after convolution
    const freqRatio = Math.exp(k * (1 - tNorm));
    inverse[i] *= 1 / Math.sqrt(freqRatio);
  }

  return inverse;
}

/**
 * Calculate the expected duration of the impulse response
 * based on typical room reverberation times
 */
export function estimateIRDuration(sampleRate: number): number {
  // Most rooms have RT60 < 2 seconds
  // We capture a bit more to be safe
  return Math.floor(2.5 * sampleRate);
}
