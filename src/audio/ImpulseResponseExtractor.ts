/**
 * ImpulseResponseExtractor - Extracts room impulse response via deconvolution
 *
 * Uses frequency-domain deconvolution to extract the room's impulse response
 * from the recorded chirp response.
 *
 * H(f) = Y(f) * conj(X(f)) / (|X(f)|² + ε)
 *
 * where:
 * - Y(f) is the FFT of the recorded signal
 * - X(f) is the FFT of the original chirp
 * - ε is a regularization term to prevent division by zero
 */

import { ImpulseResponse, AudioCaptureResult, ChirpConfig } from './types';
import {
  rfft,
  irfft,
  Complex,
  complexMul,
  complexConj,
  complexMagSq,
  nextPowerOf2,
  zeroPad,
  normalize,
} from './utils';

// Regularization parameter for deconvolution
const REGULARIZATION_EPSILON = 0.001;

/**
 * Extract the room impulse response from a captured chirp response
 */
export function extractImpulseResponse(
  captureResult: AudioCaptureResult
): ImpulseResponse {
  const { captured, chirp, sampleRate, config } = captureResult;

  // Perform deconvolution
  const ir = deconvolve(captured, chirp, config, REGULARIZATION_EPSILON);

  // Trim the IR to a reasonable length (remove noise tail)
  const trimmedIR = trimImpulseResponse(ir, sampleRate);

  return {
    data: trimmedIR,
    sampleRate,
    duration: trimmedIR.length / sampleRate,
  };
}

/**
 * Frequency-domain deconvolution
 *
 * Computes H(f) = Y(f) * conj(X(f)) / (|X(f)|² + ε)
 */
function deconvolve(
  recorded: Float32Array,
  chirp: Float32Array,
  _config: ChirpConfig,
  epsilon: number
): Float32Array {
  // Determine FFT size (must be power of 2, at least as long as both signals combined)
  const minLength = recorded.length + chirp.length - 1;
  const fftSize = nextPowerOf2(minLength);

  // Zero-pad both signals to FFT size
  const recordedPadded = zeroPad(recorded, fftSize);
  const chirpPadded = zeroPad(chirp, fftSize);

  // Compute FFTs
  const Y = rfft(recordedPadded); // Recorded signal spectrum
  const X = rfft(chirpPadded);    // Chirp spectrum

  // Compute regularized deconvolution: H = Y * conj(X) / (|X|² + ε)
  const H: Complex[] = new Array(Y.length);

  for (let i = 0; i < Y.length; i++) {
    const xConj = complexConj(X[i]);
    const numerator = complexMul(Y[i], xConj);
    const denominator = complexMagSq(X[i]) + epsilon;

    H[i] = {
      re: numerator.re / denominator,
      im: numerator.im / denominator,
    };
  }

  // Inverse FFT to get impulse response
  // We need to reconstruct the full spectrum for IFFT
  const fullSpectrum: Complex[] = new Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    if (i < H.length) {
      fullSpectrum[i] = H[i];
    } else {
      // Mirror for negative frequencies (conjugate symmetry)
      const mirrorIdx = fftSize - i;
      fullSpectrum[i] = complexConj(H[mirrorIdx]);
    }
  }

  const ir = irfft(fullSpectrum);

  // Normalize the impulse response
  return normalize(ir);
}

/**
 * Trim the impulse response to remove the noise tail
 * Uses energy-based detection to find the end of significant content
 */
function trimImpulseResponse(
  ir: Float32Array,
  sampleRate: number
): Float32Array {
  // Maximum IR length we care about (2.5 seconds should cover most rooms)
  const maxLength = Math.floor(2.5 * sampleRate);

  // Find the peak (direct sound)
  let peakIdx = 0;
  let peakVal = 0;
  for (let i = 0; i < ir.length; i++) {
    const absVal = Math.abs(ir[i]);
    if (absVal > peakVal) {
      peakVal = absVal;
      peakIdx = i;
    }
  }

  // Start from a bit before the peak to capture the direct sound
  const startIdx = Math.max(0, peakIdx - Math.floor(0.001 * sampleRate));

  // Find where the energy drops below threshold
  const threshold = peakVal * 0.001; // -60 dB below peak
  let endIdx = Math.min(ir.length, startIdx + maxLength);

  // Use a sliding window to find where energy stays below threshold
  const windowSize = Math.floor(0.05 * sampleRate); // 50ms window
  for (let i = startIdx + windowSize; i < endIdx - windowSize; i++) {
    let windowEnergy = 0;
    for (let j = 0; j < windowSize; j++) {
      windowEnergy += ir[i + j] * ir[i + j];
    }
    windowEnergy = Math.sqrt(windowEnergy / windowSize);

    if (windowEnergy < threshold) {
      endIdx = i + windowSize;
      break;
    }
  }

  // Ensure minimum length (at least 100ms)
  const minLength = Math.floor(0.1 * sampleRate);
  if (endIdx - startIdx < minLength) {
    endIdx = Math.min(ir.length, startIdx + minLength);
  }

  return ir.slice(startIdx, endIdx);
}

/**
 * Compute the Schroeder integration curve (backward integration)
 * Used for RT60 and EDT calculations
 */
export function schroederIntegration(ir: Float32Array): Float32Array {
  const length = ir.length;
  const schroeder = new Float32Array(length);

  // Compute squared IR
  const squared = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    squared[i] = ir[i] * ir[i];
  }

  // Backward integration
  let sum = 0;
  for (let i = length - 1; i >= 0; i--) {
    sum += squared[i];
    schroeder[i] = sum;
  }

  // Normalize by total energy
  const totalEnergy = schroeder[0];
  if (totalEnergy > 0) {
    for (let i = 0; i < length; i++) {
      schroeder[i] /= totalEnergy;
    }
  }

  return schroeder;
}

/**
 * Convert Schroeder curve to decibels
 */
export function schroederToDb(schroeder: Float32Array): Float32Array {
  const db = new Float32Array(schroeder.length);
  for (let i = 0; i < schroeder.length; i++) {
    db[i] = 10 * Math.log10(Math.max(schroeder[i], 1e-10));
  }
  return db;
}

/**
 * Find the time in seconds where the Schroeder curve crosses a threshold (in dB)
 */
export function findDecayTime(
  schroederDb: Float32Array,
  sampleRate: number,
  thresholdDb: number
): number {
  for (let i = 0; i < schroederDb.length; i++) {
    if (schroederDb[i] < thresholdDb) {
      return i / sampleRate;
    }
  }
  return schroederDb.length / sampleRate;
}

/**
 * Estimate RT60 from the impulse response using Schroeder integration
 * RT60 is the time for sound to decay by 60 dB
 *
 * We actually measure T30 (decay from -5 dB to -35 dB) and extrapolate
 */
export function estimateRT60(ir: Float32Array, sampleRate: number): number {
  const schroeder = schroederIntegration(ir);
  const schroederDb = schroederToDb(schroeder);

  // Find -5 dB and -35 dB crossing points
  const t5 = findDecayTime(schroederDb, sampleRate, -5);
  const t35 = findDecayTime(schroederDb, sampleRate, -35);

  // Linear extrapolation to -60 dB
  // RT60 = (t35 - t5) * 60 / 30 = 2 * (t35 - t5)
  const rt60 = 2 * (t35 - t5);

  // Clamp to reasonable values (0.1s to 5s)
  return Math.max(0.1, Math.min(5, rt60));
}

/**
 * Estimate EDT (Early Decay Time) from the impulse response
 * EDT is measured from 0 dB to -10 dB
 */
export function estimateEDT(ir: Float32Array, sampleRate: number): number {
  const schroeder = schroederIntegration(ir);
  const schroederDb = schroederToDb(schroeder);

  // Find -10 dB crossing point
  const t10 = findDecayTime(schroederDb, sampleRate, -10);

  // Extrapolate to -60 dB
  const edt = t10 * 6;

  // Clamp to reasonable values
  return Math.max(0.05, Math.min(3, edt));
}
