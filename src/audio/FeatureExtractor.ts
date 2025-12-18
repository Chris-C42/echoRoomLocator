/**
 * FeatureExtractor - Extracts acoustic features from impulse response
 *
 * Extracts a comprehensive feature vector (~60 values) including:
 * - RT60, EDT (reverberation characteristics)
 * - C50, C80 (clarity ratios)
 * - Spectral features (centroid, rolloff, flux, flatness)
 * - MFCC coefficients (mean and variance)
 * - Early reflection energy
 * - Octave band energy
 */

import {
  ImpulseResponse,
  FeatureVector,
  FEATURE_VECTOR_LENGTH,
  OrientationAwareFeatures,
  LateReverbFeatures,
  EarlyReflectionFeatures,
  FeatureMetadata,
  MIXING_TIME_MS,
  LATE_REVERB_FEATURE_LENGTH,
  EARLY_REFLECTION_FEATURE_LENGTH,
} from './types';
import {
  estimateRT60,
  estimateEDT,
} from './ImpulseResponseExtractor';
import {
  rfft,
  powerSpectrum,
  hannWindow,
  applyWindow,
  frameSignal,
  melFilterbank,
  dct,
  mean,
  variance,
  linearToDb,
} from './utils';

// MFCC configuration
const NUM_MFCC = 13;
const NUM_MEL_FILTERS = 26;
const FRAME_SIZE_MS = 25;
const FRAME_HOP_MS = 10;

// Early reflection time bins (0-80ms in 10ms steps)
const EARLY_REFLECTION_BINS = 8;
const EARLY_REFLECTION_STEP_MS = 10;

// Octave band center frequencies (Hz)
const OCTAVE_BANDS = [125, 250, 500, 1000, 2000, 4000, 8000];

/**
 * Extract all features from an impulse response
 */
export function extractFeatures(ir: ImpulseResponse): FeatureVector {
  const { data, sampleRate } = ir;

  // Reverberation characteristics
  const rt60 = estimateRT60(data, sampleRate);
  const edt = estimateEDT(data, sampleRate);

  // Clarity ratios
  const c50 = computeClarityRatio(data, sampleRate, 0.05);
  const c80 = computeClarityRatio(data, sampleRate, 0.08);

  // Spectral features
  const spectralFeatures = computeSpectralFeatures(data, sampleRate);

  // MFCC features
  const { mfccMean, mfccVariance } = computeMFCCFeatures(data, sampleRate);

  // Early reflection energy
  const earlyReflections = computeEarlyReflectionEnergy(data, sampleRate);

  // Octave band energy
  const octaveBands = computeOctaveBandEnergy(data, sampleRate);

  // Compile raw feature vector
  const raw = compileFeatureVector({
    rt60,
    edt,
    c50,
    c80,
    ...spectralFeatures,
    mfccMean,
    mfccVariance,
    earlyReflections,
    octaveBands,
  });

  return {
    rt60,
    edt,
    c50,
    c80,
    ...spectralFeatures,
    mfccMean,
    mfccVariance,
    earlyReflections,
    octaveBands,
    raw,
  };
}

/**
 * Compute clarity ratio C(t) = 10 * log10(E_early / E_late)
 * where E_early is energy in first t seconds, E_late is remaining energy
 */
function computeClarityRatio(
  ir: Float32Array,
  sampleRate: number,
  timeSeconds: number
): number {
  const splitSample = Math.floor(timeSeconds * sampleRate);

  let earlyEnergy = 0;
  let lateEnergy = 0;

  for (let i = 0; i < ir.length; i++) {
    const energy = ir[i] * ir[i];
    if (i < splitSample) {
      earlyEnergy += energy;
    } else {
      lateEnergy += energy;
    }
  }

  // Prevent division by zero
  if (lateEnergy < 1e-10) {
    return 20; // Maximum clarity (all energy is early)
  }

  return 10 * Math.log10(earlyEnergy / lateEnergy);
}

/**
 * Compute spectral features from the impulse response
 */
function computeSpectralFeatures(
  ir: Float32Array,
  sampleRate: number
): {
  spectralCentroid: number;
  spectralRolloff: number;
  spectralFlux: number;
  spectralFlatness: number;
} {
  // Compute spectrum
  const spectrum = rfft(ir);
  const power = powerSpectrum(spectrum);

  // Frequency resolution
  const freqResolution = sampleRate / (spectrum.length * 2);

  // Spectral centroid: weighted mean of frequencies
  let weightedSum = 0;
  let totalPower = 0;
  for (let i = 0; i < power.length; i++) {
    const freq = i * freqResolution;
    weightedSum += freq * power[i];
    totalPower += power[i];
  }
  const spectralCentroid = totalPower > 0 ? weightedSum / totalPower : 0;

  // Spectral rolloff: frequency below which 85% of power is contained
  const rolloffThreshold = 0.85 * totalPower;
  let cumulativePower = 0;
  let spectralRolloff = 0;
  for (let i = 0; i < power.length; i++) {
    cumulativePower += power[i];
    if (cumulativePower >= rolloffThreshold) {
      spectralRolloff = i * freqResolution;
      break;
    }
  }

  // Spectral flux: L2 norm of spectrum (simplified single-frame version)
  let flux = 0;
  for (let i = 0; i < power.length; i++) {
    flux += power[i];
  }
  const spectralFlux = Math.sqrt(flux);

  // Spectral flatness: geometric mean / arithmetic mean
  // Indicates how noise-like (flat) vs tonal the signal is
  let logSum = 0;
  let linearSum = 0;
  let validBins = 0;
  for (let i = 1; i < power.length; i++) {
    if (power[i] > 1e-10) {
      logSum += Math.log(power[i]);
      linearSum += power[i];
      validBins++;
    }
  }
  const geometricMean = validBins > 0 ? Math.exp(logSum / validBins) : 0;
  const arithmeticMean = validBins > 0 ? linearSum / validBins : 0;
  const spectralFlatness = arithmeticMean > 0 ? geometricMean / arithmeticMean : 0;

  return {
    spectralCentroid,
    spectralRolloff,
    spectralFlux,
    spectralFlatness,
  };
}

/**
 * Compute MFCC features (mean and variance across frames)
 */
function computeMFCCFeatures(
  ir: Float32Array,
  sampleRate: number
): {
  mfccMean: number[];
  mfccVariance: number[];
} {
  const frameSize = Math.floor((FRAME_SIZE_MS / 1000) * sampleRate);
  const hopSize = Math.floor((FRAME_HOP_MS / 1000) * sampleRate);

  // Frame the signal
  const frames = frameSignal(ir, frameSize, hopSize);

  if (frames.length === 0) {
    // Return zeros if signal too short
    return {
      mfccMean: new Array(NUM_MFCC).fill(0),
      mfccVariance: new Array(NUM_MFCC).fill(0),
    };
  }

  // Create window and mel filterbank
  const window = hannWindow(frameSize);
  const filterbank = melFilterbank(NUM_MEL_FILTERS, frameSize, sampleRate, 0, sampleRate / 2);

  // Compute MFCCs for each frame
  const allMfccs: number[][] = [];

  for (const frame of frames) {
    // Apply window
    const windowed = applyWindow(frame, window);

    // Compute power spectrum
    const spectrum = rfft(windowed);
    const power = powerSpectrum(spectrum);

    // Apply mel filterbank
    const melEnergies = new Float32Array(NUM_MEL_FILTERS);
    for (let i = 0; i < NUM_MEL_FILTERS; i++) {
      let energy = 0;
      for (let j = 0; j < Math.min(power.length, filterbank[i].length); j++) {
        energy += power[j] * filterbank[i][j];
      }
      melEnergies[i] = Math.log(Math.max(energy, 1e-10));
    }

    // Apply DCT to get MFCCs
    const mfccs = dct(melEnergies, NUM_MFCC);
    allMfccs.push(Array.from(mfccs));
  }

  // Compute mean and variance across frames
  const mfccMean: number[] = [];
  const mfccVariance: number[] = [];

  for (let i = 0; i < NUM_MFCC; i++) {
    const values = allMfccs.map((frame) => frame[i]);
    mfccMean.push(mean(values));
    mfccVariance.push(variance(values));
  }

  return { mfccMean, mfccVariance };
}

/**
 * Compute early reflection energy in time bins
 */
function computeEarlyReflectionEnergy(
  ir: Float32Array,
  sampleRate: number
): number[] {
  const energies: number[] = [];
  const binSamples = Math.floor((EARLY_REFLECTION_STEP_MS / 1000) * sampleRate);

  for (let bin = 0; bin < EARLY_REFLECTION_BINS; bin++) {
    const start = bin * binSamples;
    const end = Math.min((bin + 1) * binSamples, ir.length);

    let energy = 0;
    for (let i = start; i < end; i++) {
      energy += ir[i] * ir[i];
    }

    // Convert to dB (relative to first bin)
    energies.push(energy);
  }

  // Normalize relative to first bin
  const refEnergy = Math.max(energies[0], 1e-10);
  return energies.map((e) => linearToDb(Math.sqrt(e / refEnergy)));
}

/**
 * Compute octave band energy
 */
function computeOctaveBandEnergy(
  ir: Float32Array,
  sampleRate: number
): number[] {
  const spectrum = rfft(ir);
  const power = powerSpectrum(spectrum);
  const freqResolution = sampleRate / (spectrum.length * 2);

  const energies: number[] = [];

  for (const centerFreq of OCTAVE_BANDS) {
    // Octave band spans from centerFreq/sqrt(2) to centerFreq*sqrt(2)
    const lowFreq = centerFreq / Math.SQRT2;
    const highFreq = centerFreq * Math.SQRT2;

    const lowBin = Math.floor(lowFreq / freqResolution);
    const highBin = Math.min(Math.ceil(highFreq / freqResolution), power.length - 1);

    let energy = 0;
    for (let i = lowBin; i <= highBin; i++) {
      energy += power[i];
    }

    energies.push(energy);
  }

  // Normalize and convert to dB
  const totalEnergy = energies.reduce((a, b) => a + b, 0);
  if (totalEnergy > 0) {
    return energies.map((e) => linearToDb(Math.sqrt(e / totalEnergy)));
  }

  return energies.map(() => -60); // Minimum dB if no energy
}

/**
 * Compile all features into a single vector for ML input
 */
function compileFeatureVector(features: Omit<FeatureVector, 'raw'>): number[] {
  const vector: number[] = [];

  // Reverberation (2)
  vector.push(features.rt60);
  vector.push(features.edt);

  // Clarity (2)
  vector.push(features.c50);
  vector.push(features.c80);

  // Spectral (4)
  vector.push(features.spectralCentroid / 10000); // Normalize to ~0-1 range
  vector.push(features.spectralRolloff / 20000);  // Normalize to ~0-1 range
  vector.push(features.spectralFlux);
  vector.push(features.spectralFlatness);

  // MFCC mean (13)
  vector.push(...features.mfccMean);

  // MFCC variance (13)
  vector.push(...features.mfccVariance);

  // Early reflections (8)
  vector.push(...features.earlyReflections);

  // Octave bands (7)
  vector.push(...features.octaveBands);

  // Pad to fixed length if needed
  while (vector.length < FEATURE_VECTOR_LENGTH) {
    vector.push(0);
  }

  return vector.slice(0, FEATURE_VECTOR_LENGTH);
}

/**
 * Extract features directly from captured audio result
 * Convenience function that combines IR extraction and feature extraction
 */
export function extractFeaturesFromCapture(
  captured: Float32Array,
  chirp: Float32Array,
  sampleRate: number
): FeatureVector {
  // Import here to avoid circular dependency
  const { extractImpulseResponse } = require('./ImpulseResponseExtractor');

  const ir = extractImpulseResponse({
    captured,
    chirp,
    sampleRate,
    config: {
      mode: 'audible',
      startFrequency: 200,
      endFrequency: 18000,
      duration: 0.5,
      sampleRate,
      fadeTime: 0.01,
    },
    timestamp: Date.now(),
  });

  return extractFeatures(ir);
}

// ============================================================================
// ORIENTATION-AWARE FEATURE EXTRACTION
// Separates features into orientation-invariant (late reverb) and
// orientation-sensitive (early reflections) groups
// ============================================================================

/**
 * Extract orientation-aware features from impulse response
 * This is the preferred method for training orientation-robust models
 */
export function extractOrientationAwareFeatures(ir: ImpulseResponse): OrientationAwareFeatures {
  const { data, sampleRate } = ir;

  // Detect mixing time (when sound field becomes diffuse)
  const mixingTimeMs = detectMixingTime(data, sampleRate);
  const mixingSample = Math.floor((mixingTimeMs / 1000) * sampleRate);

  // Extract late reverb features (orientation-invariant)
  const lateReverbFeatures = extractLateReverbFeatures(data, sampleRate, mixingSample);

  // Extract early reflection features (orientation-sensitive)
  const earlyReflectionFeatures = extractEarlyReflectionFeaturesGrouped(data, sampleRate, mixingSample);

  // Compute confidence in late reverb estimation
  const lateReverbConfidence = computeLateReverbConfidence(data, sampleRate, mixingSample);

  // Compile raw vector: late features first, then early features
  const raw = compileOrientationAwareVector(lateReverbFeatures, earlyReflectionFeatures);

  const featureMetadata: FeatureMetadata = {
    lateFeatureCount: LATE_REVERB_FEATURE_LENGTH,
    earlyFeatureCount: EARLY_REFLECTION_FEATURE_LENGTH,
    lateFeatureStartIdx: 0,
    lateFeatureEndIdx: LATE_REVERB_FEATURE_LENGTH,
    earlyFeatureStartIdx: LATE_REVERB_FEATURE_LENGTH,
    earlyFeatureEndIdx: LATE_REVERB_FEATURE_LENGTH + EARLY_REFLECTION_FEATURE_LENGTH,
    detectedMixingTimeMs: mixingTimeMs,
    lateReverbConfidence,
  };

  return {
    lateReverbFeatures,
    earlyReflectionFeatures,
    raw,
    featureMetadata,
  };
}

/**
 * Detect mixing time - when the sound field transitions from early reflections to diffuse
 * Uses the normalized echo density to find when reflections become statistically uniform
 */
function detectMixingTime(ir: Float32Array, sampleRate: number): number {
  // Default mixing time from acoustic literature
  const defaultMixingTimeMs = MIXING_TIME_MS;

  // For short IRs, use default
  const irDurationMs = (ir.length / sampleRate) * 1000;
  if (irDurationMs < defaultMixingTimeMs * 1.5) {
    return Math.min(defaultMixingTimeMs, irDurationMs * 0.5);
  }

  // Compute energy envelope in small windows
  const windowMs = 5; // 5ms windows
  const windowSamples = Math.floor((windowMs / 1000) * sampleRate);
  const numWindows = Math.floor(ir.length / windowSamples);

  if (numWindows < 10) {
    return defaultMixingTimeMs;
  }

  const energyEnvelope: number[] = [];
  for (let w = 0; w < numWindows; w++) {
    let energy = 0;
    const start = w * windowSamples;
    const end = Math.min(start + windowSamples, ir.length);
    for (let i = start; i < end; i++) {
      energy += ir[i] * ir[i];
    }
    energyEnvelope.push(energy);
  }

  // Compute local variance of energy (smoothed)
  // High variance = discrete reflections, low variance = diffuse field
  const varianceWindow = 5;
  const localVariances: number[] = [];

  for (let i = varianceWindow; i < energyEnvelope.length - varianceWindow; i++) {
    const segment = energyEnvelope.slice(i - varianceWindow, i + varianceWindow + 1);
    const segMean = segment.reduce((a, b) => a + b, 0) / segment.length;
    const segVar = segment.reduce((a, b) => a + (b - segMean) ** 2, 0) / segment.length;
    // Normalize variance by mean squared to get coefficient of variation
    const cv = segMean > 1e-10 ? Math.sqrt(segVar) / segMean : 0;
    localVariances.push(cv);
  }

  // Find where coefficient of variation drops below threshold
  // This indicates transition to diffuse field
  const cvThreshold = 0.5; // Empirical threshold
  let mixingWindowIdx = localVariances.length;

  for (let i = 0; i < localVariances.length; i++) {
    if (localVariances[i] < cvThreshold) {
      // Confirm it stays low for a few windows
      let staysLow = true;
      for (let j = i; j < Math.min(i + 3, localVariances.length); j++) {
        if (localVariances[j] >= cvThreshold) {
          staysLow = false;
          break;
        }
      }
      if (staysLow) {
        mixingWindowIdx = i + varianceWindow;
        break;
      }
    }
  }

  const detectedMs = mixingWindowIdx * windowMs;

  // Clamp to reasonable range (20ms - 150ms based on acoustic literature)
  return Math.max(20, Math.min(150, detectedMs));
}

/**
 * Extract features from late reverberation (orientation-invariant)
 */
function extractLateReverbFeatures(
  ir: Float32Array,
  sampleRate: number,
  mixingSample: number
): LateReverbFeatures {
  // Extract late portion of IR
  const lateIR = ir.slice(mixingSample);

  if (lateIR.length < sampleRate * 0.05) {
    // Less than 50ms of late reverb - return default values
    return getDefaultLateReverbFeatures(mixingSample / sampleRate * 1000);
  }

  // Late RT60 - estimate from late portion only
  const lateRT60 = estimateRT60FromLate(lateIR, sampleRate);

  // Late decay rates per octave band
  const lateDecayRates = computeLateDecayRates(lateIR, sampleRate);

  // Late reverb spectral envelope
  const lateSpectralEnvelope = computeLateSpectralEnvelope(lateIR, sampleRate);

  // Total late energy (normalized)
  const totalIREnergy = computeTotalEnergy(ir);
  const lateEnergy = computeTotalEnergy(lateIR) / Math.max(totalIREnergy, 1e-10);

  // Spectral centroid of late reverb
  const lateSpectralCentroid = computeSpectralCentroidSingle(lateIR, sampleRate);

  // Spectral flatness of late reverb
  const lateSpectralFlatness = computeSpectralFlatnessSingle(lateIR, sampleRate);

  // Low frequency mode energy (<300Hz)
  const lowFreqModeEnergy = computeLowFreqEnergy(lateIR, sampleRate, 300);

  return {
    lateRT60,
    lateDecayRates,
    lateSpectralEnvelope,
    lateEnergy,
    lateSpectralCentroid,
    lateSpectralFlatness,
    lowFreqModeEnergy,
    mixingTime: mixingSample / sampleRate * 1000,
  };
}

/**
 * Estimate RT60 from late reverb portion using Schroeder integration
 */
function estimateRT60FromLate(lateIR: Float32Array, sampleRate: number): number {
  // Schroeder backward integration
  const schroeder = new Float32Array(lateIR.length);
  let cumsum = 0;

  for (let i = lateIR.length - 1; i >= 0; i--) {
    cumsum += lateIR[i] * lateIR[i];
    schroeder[i] = cumsum;
  }

  // Convert to dB
  const maxEnergy = Math.max(schroeder[0], 1e-10);
  const schroederDb = schroeder.map((s) => 10 * Math.log10(s / maxEnergy + 1e-10));

  // Find -5dB and -25dB points for T20 estimation
  let idx5dB = 0;
  let idx25dB = 0;

  for (let i = 0; i < schroederDb.length; i++) {
    if (schroederDb[i] <= -5 && idx5dB === 0) {
      idx5dB = i;
    }
    if (schroederDb[i] <= -25) {
      idx25dB = i;
      break;
    }
  }

  if (idx25dB <= idx5dB || idx5dB === 0) {
    return 0.5; // Default fallback
  }

  // Linear regression to estimate decay rate
  const t5 = idx5dB / sampleRate;
  const t25 = idx25dB / sampleRate;
  const decayRate = -20 / (t25 - t5); // dB/s

  // Extrapolate to -60dB
  const rt60 = 60 / Math.abs(decayRate);

  return Math.max(0.1, Math.min(5.0, rt60)); // Clamp to reasonable range
}

/**
 * Compute decay rates per octave band in late reverb
 */
function computeLateDecayRates(lateIR: Float32Array, sampleRate: number): number[] {
  const octaveBands = [125, 250, 500, 1000, 2000, 4000, 8000];
  const decayRates: number[] = [];

  for (const centerFreq of octaveBands) {
    // Bandpass filter the late IR
    const filtered = bandpassFilter(lateIR, sampleRate, centerFreq);

    // Estimate decay rate for this band
    const rt60 = estimateRT60FromLate(filtered, sampleRate);
    decayRates.push(rt60);
  }

  return decayRates;
}

/**
 * Simple bandpass filter for octave band analysis
 * Uses FFT-based filtering by zeroing out-of-band frequencies
 */
function bandpassFilter(signal: Float32Array, sampleRate: number, centerFreq: number): Float32Array {
  const lowFreq = centerFreq / Math.SQRT2;
  const highFreq = Math.min(centerFreq * Math.SQRT2, sampleRate / 2 - 1);

  // Use FFT-based filtering
  const spectrum = rfft(signal);
  const freqResolution = sampleRate / (spectrum.length * 2);

  const lowBin = Math.floor(lowFreq / freqResolution);
  const highBin = Math.min(Math.ceil(highFreq / freqResolution), spectrum.length - 1);

  // Create filtered spectrum with only in-band frequencies
  const filteredSpectrum = spectrum.map((c, i) => {
    if (i >= lowBin && i <= highBin) {
      return c; // Keep in-band
    }
    return { re: 0, im: 0 }; // Zero out-of-band
  });

  // Compute energy envelope from filtered spectrum
  // For decay rate estimation, we only need the energy envelope
  const power = powerSpectrum(filteredSpectrum);

  // Create time-domain energy envelope (simplified reconstruction)
  const windowSize = Math.floor(sampleRate * 0.01); // 10ms windows
  const numWindows = Math.floor(signal.length / windowSize);
  const filtered = new Float32Array(signal.length);

  // Compute band-limited energy in each window
  for (let w = 0; w < numWindows; w++) {
    let bandEnergy = 0;
    for (let k = lowBin; k <= highBin && k < power.length; k++) {
      bandEnergy += power[k];
    }
    // Spread energy across window samples
    const windowEnergy = Math.sqrt(bandEnergy / (highBin - lowBin + 1));
    const start = w * windowSize;
    const end = Math.min(start + windowSize, signal.length);
    for (let i = start; i < end; i++) {
      // Modulate by original signal envelope for temporal structure
      filtered[i] = windowEnergy * Math.abs(signal[i]);
    }
  }

  return filtered;
}

/**
 * Compute spectral envelope of late reverb (octave band energies)
 */
function computeLateSpectralEnvelope(lateIR: Float32Array, sampleRate: number): number[] {
  const spectrum = rfft(lateIR);
  const power = powerSpectrum(spectrum);
  const freqResolution = sampleRate / (spectrum.length * 2);

  const octaveBands = [125, 250, 500, 1000, 2000, 4000, 8000];
  const envelope: number[] = [];

  let totalEnergy = 0;
  const bandEnergies: number[] = [];

  for (const centerFreq of octaveBands) {
    const lowFreq = centerFreq / Math.SQRT2;
    const highFreq = Math.min(centerFreq * Math.SQRT2, sampleRate / 2 - 1);

    const lowBin = Math.floor(lowFreq / freqResolution);
    const highBin = Math.min(Math.ceil(highFreq / freqResolution), power.length - 1);

    let energy = 0;
    for (let i = lowBin; i <= highBin; i++) {
      energy += power[i];
    }

    bandEnergies.push(energy);
    totalEnergy += energy;
  }

  // Normalize and convert to dB relative to total
  for (const energy of bandEnergies) {
    const normalized = totalEnergy > 0 ? energy / totalEnergy : 0;
    envelope.push(linearToDb(Math.sqrt(normalized)));
  }

  return envelope;
}

/**
 * Compute total energy of a signal
 */
function computeTotalEnergy(signal: Float32Array): number {
  let energy = 0;
  for (let i = 0; i < signal.length; i++) {
    energy += signal[i] * signal[i];
  }
  return energy;
}

/**
 * Compute spectral centroid of a signal
 */
function computeSpectralCentroidSingle(signal: Float32Array, sampleRate: number): number {
  const spectrum = rfft(signal);
  const power = powerSpectrum(spectrum);
  const freqResolution = sampleRate / (spectrum.length * 2);

  let weightedSum = 0;
  let totalPower = 0;

  for (let i = 0; i < power.length; i++) {
    const freq = i * freqResolution;
    weightedSum += freq * power[i];
    totalPower += power[i];
  }

  const centroid = totalPower > 0 ? weightedSum / totalPower : 0;
  // Normalize to 0-1 range (assuming max ~10kHz)
  return Math.min(centroid / 10000, 1);
}

/**
 * Compute spectral flatness of a signal
 */
function computeSpectralFlatnessSingle(signal: Float32Array, _sampleRate: number): number {
  const spectrum = rfft(signal);
  const power = powerSpectrum(spectrum);

  let logSum = 0;
  let linearSum = 0;
  let validBins = 0;

  for (let i = 1; i < power.length; i++) {
    if (power[i] > 1e-10) {
      logSum += Math.log(power[i]);
      linearSum += power[i];
      validBins++;
    }
  }

  if (validBins === 0) return 0;

  const geometricMean = Math.exp(logSum / validBins);
  const arithmeticMean = linearSum / validBins;

  return arithmeticMean > 0 ? geometricMean / arithmeticMean : 0;
}

/**
 * Compute energy below a frequency threshold
 */
function computeLowFreqEnergy(signal: Float32Array, sampleRate: number, maxFreq: number): number {
  const spectrum = rfft(signal);
  const power = powerSpectrum(spectrum);
  const freqResolution = sampleRate / (spectrum.length * 2);

  const maxBin = Math.min(Math.ceil(maxFreq / freqResolution), power.length - 1);

  let lowEnergy = 0;
  let totalEnergy = 0;

  for (let i = 0; i < power.length; i++) {
    totalEnergy += power[i];
    if (i <= maxBin) {
      lowEnergy += power[i];
    }
  }

  return totalEnergy > 0 ? lowEnergy / totalEnergy : 0;
}

/**
 * Get default late reverb features for short IRs
 */
function getDefaultLateReverbFeatures(mixingTimeMs: number): LateReverbFeatures {
  return {
    lateRT60: 0.5,
    lateDecayRates: [0.5, 0.5, 0.5, 0.4, 0.4, 0.3, 0.3],
    lateSpectralEnvelope: [-6, -6, -6, -6, -6, -6, -6],
    lateEnergy: 0.3,
    lateSpectralCentroid: 0.2,
    lateSpectralFlatness: 0.5,
    lowFreqModeEnergy: 0.2,
    mixingTime: mixingTimeMs,
  };
}

/**
 * Extract early reflection features (orientation-sensitive)
 */
function extractEarlyReflectionFeaturesGrouped(
  ir: Float32Array,
  sampleRate: number,
  _mixingSample: number
): EarlyReflectionFeatures {
  // Use original feature extraction methods for early portion
  const edt = estimateEDT(ir, sampleRate);
  const c50 = computeClarityRatio(ir, sampleRate, 0.05);
  const c80 = computeClarityRatio(ir, sampleRate, 0.08);
  const earlyReflections = computeEarlyReflectionEnergy(ir, sampleRate);

  const spectral = computeSpectralFeatures(ir, sampleRate);
  const { mfccMean, mfccVariance } = computeMFCCFeatures(ir, sampleRate);
  const octaveBands = computeOctaveBandEnergy(ir, sampleRate);

  return {
    edt,
    c50,
    c80,
    earlyReflections,
    spectralCentroid: spectral.spectralCentroid,
    spectralRolloff: spectral.spectralRolloff,
    spectralFlux: spectral.spectralFlux,
    spectralFlatness: spectral.spectralFlatness,
    mfccMean,
    mfccVariance,
    octaveBands,
  };
}

/**
 * Compute confidence in late reverb estimation
 * Low confidence if IR is too short, too noisy, or late portion has insufficient energy
 */
function computeLateReverbConfidence(
  ir: Float32Array,
  sampleRate: number,
  mixingSample: number
): number {
  const lateIR = ir.slice(mixingSample);

  // Check 1: Sufficient length (at least 100ms of late reverb)
  const minLateLengthMs = 100;
  const actualLateLengthMs = (lateIR.length / sampleRate) * 1000;
  const lengthScore = Math.min(actualLateLengthMs / minLateLengthMs, 1);

  // Check 2: Sufficient energy ratio (late should have meaningful energy)
  const totalEnergy = computeTotalEnergy(ir);
  const lateEnergy = computeTotalEnergy(lateIR);
  const energyRatio = totalEnergy > 0 ? lateEnergy / totalEnergy : 0;
  // We expect ~20-50% of energy in late reverb for typical rooms
  const energyScore = Math.min(energyRatio / 0.2, 1);

  // Check 3: Smooth decay (late reverb should decay smoothly)
  // Compute variance of energy envelope
  const windowMs = 10;
  const windowSamples = Math.floor((windowMs / 1000) * sampleRate);
  const numWindows = Math.floor(lateIR.length / windowSamples);

  if (numWindows < 5) {
    return lengthScore * 0.5; // Low confidence if too short
  }

  const energyEnvelope: number[] = [];
  for (let w = 0; w < numWindows; w++) {
    let energy = 0;
    const start = w * windowSamples;
    const end = Math.min(start + windowSamples, lateIR.length);
    for (let i = start; i < end; i++) {
      energy += lateIR[i] * lateIR[i];
    }
    energyEnvelope.push(energy);
  }

  // Check if energy is monotonically decreasing (approximately)
  let decreaseCount = 0;
  for (let i = 1; i < energyEnvelope.length; i++) {
    if (energyEnvelope[i] <= energyEnvelope[i - 1] * 1.1) {
      decreaseCount++;
    }
  }
  const smoothnessScore = decreaseCount / (energyEnvelope.length - 1);

  // Combine scores
  return lengthScore * 0.3 + energyScore * 0.3 + smoothnessScore * 0.4;
}

/**
 * Compile orientation-aware features into a single vector
 * Late features come first (orientation-invariant), then early features
 */
function compileOrientationAwareVector(
  late: LateReverbFeatures,
  early: EarlyReflectionFeatures
): number[] {
  const vector: number[] = [];

  // Late reverb features (20 values) - ORIENTATION INVARIANT
  vector.push(late.lateRT60);                    // 1
  vector.push(...late.lateDecayRates);           // 7
  vector.push(...late.lateSpectralEnvelope);     // 7
  vector.push(late.lateEnergy);                  // 1
  vector.push(late.lateSpectralCentroid);        // 1
  vector.push(late.lateSpectralFlatness);        // 1
  vector.push(late.lowFreqModeEnergy);           // 1
  vector.push(late.mixingTime / 1000);           // 1 (normalized to seconds)

  // Early reflection features (48 values) - ORIENTATION SENSITIVE
  vector.push(early.edt);                        // 1
  vector.push(early.c50);                        // 1
  vector.push(early.c80);                        // 1
  vector.push(...early.earlyReflections);        // 8
  vector.push(early.spectralCentroid / 10000);   // 1 (normalized)
  vector.push(early.spectralRolloff / 20000);    // 1 (normalized)
  vector.push(early.spectralFlux);               // 1
  vector.push(early.spectralFlatness);           // 1
  vector.push(...early.mfccMean);                // 13
  vector.push(...early.mfccVariance);            // 13
  vector.push(...early.octaveBands);             // 7

  return vector;
}

/**
 * Convert standard FeatureVector to OrientationAwareFeatures
 * Useful for backward compatibility with existing samples
 */
export function convertToOrientationAwareFeatures(
  _features: FeatureVector,
  ir: ImpulseResponse
): OrientationAwareFeatures {
  // Extract the full orientation-aware features from the IR
  return extractOrientationAwareFeatures(ir);
}
