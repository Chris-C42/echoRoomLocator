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

import { ImpulseResponse, FeatureVector, FEATURE_VECTOR_LENGTH } from './types';
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
