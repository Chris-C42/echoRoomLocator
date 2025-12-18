/**
 * AmbientFeatureExtractor - Extracts acoustic features from ambient audio
 *
 * Unlike the chirp-based FeatureExtractor which analyzes impulse response,
 * this extracts features directly from passive ambient recordings:
 * - Spectral features (temporal statistics)
 * - MFCC with delta coefficients
 * - Noise floor characteristics
 * - HVAC/hum detection (power line harmonics)
 * - Background periodicity (autocorrelation)
 *
 * Total features: ~73 values
 */

import { AmbientFeatureVector, AMBIENT_FEATURE_LENGTH } from './types';
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
  std,
  rms,
  linearToDb,
  percentile,
  detectPeaksAtFrequencies,
  autocorrelation,
  octaveBandEnergies,
} from './utils';

// Configuration
const NUM_MFCC = 13;
const NUM_MEL_FILTERS = 26;
const FRAME_SIZE_MS = 50;  // Larger frames for ambient (more stable)
const FRAME_HOP_MS = 25;

// HVAC frequencies (50Hz and 60Hz power line harmonics)
const HVAC_FREQUENCIES = [50, 60, 100, 120, 150, 180];

// Octave band center frequencies (10 bands for ambient)
const AMBIENT_OCTAVE_BANDS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/**
 * Extract ambient audio features
 *
 * @param audio - Raw audio samples
 * @param sampleRate - Sample rate in Hz
 */
export function extractAmbientFeatures(
  audio: Float32Array,
  sampleRate: number
): AmbientFeatureVector {
  console.log('[AmbientFeatureExtractor] Processing', audio.length, 'samples at', sampleRate, 'Hz');

  // Frame the signal for temporal analysis
  const frameSize = Math.floor((FRAME_SIZE_MS / 1000) * sampleRate);
  const hopSize = Math.floor((FRAME_HOP_MS / 1000) * sampleRate);
  const frames = frameSignal(audio, frameSize, hopSize);

  console.log('[AmbientFeatureExtractor] Split into', frames.length, 'frames');

  // Compute spectral features per frame
  const spectralStats = computeSpectralStats(frames, sampleRate);

  // Compute MFCC features with delta
  const mfccFeatures = computeMFCCWithDelta(frames, sampleRate);

  // Compute noise floor characteristics
  const noiseFloor = computeNoiseFloor(frames);

  // Compute octave band energies from full signal
  const fullSpectrum = rfft(audio);
  const fullPower = powerSpectrum(fullSpectrum);
  const octaveBands = octaveBandEnergies(fullPower, sampleRate, AMBIENT_OCTAVE_BANDS);

  // Compute power variance across frames
  const powerVariance = computePowerVariance(frames);

  // Detect HVAC/hum peaks
  const hvacPeaks = detectPeaksAtFrequencies(fullPower, sampleRate, HVAC_FREQUENCIES);

  // Compute autocorrelation for periodicity
  const autocorrelationPeaks = autocorrelation(audio, Math.floor(sampleRate * 0.5), 5);

  // Compile raw feature vector
  const raw = compileAmbientFeatureVector({
    spectralStats,
    mfccFeatures,
    noiseFloor,
    octaveBands,
    powerVariance,
    hvacPeaks,
    autocorrelationPeaks,
  });

  console.log('[AmbientFeatureExtractor] Extracted', raw.length, 'features');

  return {
    spectralCentroidMean: spectralStats.centroidMean,
    spectralCentroidStd: spectralStats.centroidStd,
    spectralRolloffMean: spectralStats.rolloffMean,
    spectralRolloffStd: spectralStats.rolloffStd,
    spectralFluxMean: spectralStats.fluxMean,
    spectralFluxStd: spectralStats.fluxStd,
    spectralFlatnessMean: spectralStats.flatnessMean,
    spectralFlatnessStd: spectralStats.flatnessStd,
    mfccMean: mfccFeatures.mean,
    mfccVariance: mfccFeatures.variance,
    mfccDelta: mfccFeatures.delta,
    rmsLevel: noiseFloor.rmsLevel,
    rmsPercentile10: noiseFloor.percentile10,
    rmsPercentile50: noiseFloor.percentile50,
    rmsPercentile90: noiseFloor.percentile90,
    octaveBands,
    powerVariance,
    hvacPeaks,
    autocorrelation: autocorrelationPeaks,
    raw,
  };
}

/**
 * Compute spectral features with temporal statistics
 */
function computeSpectralStats(
  frames: Float32Array[],
  sampleRate: number
): {
  centroidMean: number;
  centroidStd: number;
  rolloffMean: number;
  rolloffStd: number;
  fluxMean: number;
  fluxStd: number;
  flatnessMean: number;
  flatnessStd: number;
} {
  if (frames.length === 0) {
    return {
      centroidMean: 0,
      centroidStd: 0,
      rolloffMean: 0,
      rolloffStd: 0,
      fluxMean: 0,
      fluxStd: 0,
      flatnessMean: 0,
      flatnessStd: 0,
    };
  }

  const window = hannWindow(frames[0].length);
  const centroids: number[] = [];
  const rolloffs: number[] = [];
  const fluxes: number[] = [];
  const flatnesses: number[] = [];

  let prevPower: Float32Array | null = null;

  for (const frame of frames) {
    const windowed = applyWindow(frame, window);
    const spectrum = rfft(windowed);
    const power = powerSpectrum(spectrum);

    const freqResolution = sampleRate / (spectrum.length * 2);

    // Spectral centroid
    let weightedSum = 0;
    let totalPower = 0;
    for (let i = 0; i < power.length; i++) {
      const freq = i * freqResolution;
      weightedSum += freq * power[i];
      totalPower += power[i];
    }
    centroids.push(totalPower > 0 ? weightedSum / totalPower : 0);

    // Spectral rolloff (85%)
    const threshold = 0.85 * totalPower;
    let cumulative = 0;
    let rolloff = 0;
    for (let i = 0; i < power.length; i++) {
      cumulative += power[i];
      if (cumulative >= threshold) {
        rolloff = i * freqResolution;
        break;
      }
    }
    rolloffs.push(rolloff);

    // Spectral flux (change from previous frame)
    if (prevPower !== null) {
      let flux = 0;
      for (let i = 0; i < power.length; i++) {
        const diff = power[i] - prevPower[i];
        flux += diff * diff;
      }
      fluxes.push(Math.sqrt(flux));
    } else {
      fluxes.push(0);
    }
    prevPower = power;

    // Spectral flatness
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
    const geomMean = validBins > 0 ? Math.exp(logSum / validBins) : 0;
    const arithMean = validBins > 0 ? linearSum / validBins : 0;
    flatnesses.push(arithMean > 0 ? geomMean / arithMean : 0);
  }

  return {
    centroidMean: mean(centroids) / 10000,  // Normalize
    centroidStd: std(centroids) / 10000,
    rolloffMean: mean(rolloffs) / 20000,
    rolloffStd: std(rolloffs) / 20000,
    fluxMean: mean(fluxes),
    fluxStd: std(fluxes),
    flatnessMean: mean(flatnesses),
    flatnessStd: std(flatnesses),
  };
}

/**
 * Compute MFCC features with delta (rate of change) coefficients
 */
function computeMFCCWithDelta(
  frames: Float32Array[],
  sampleRate: number
): {
  mean: number[];
  variance: number[];
  delta: number[];
} {
  if (frames.length === 0) {
    return {
      mean: new Array(NUM_MFCC).fill(0),
      variance: new Array(NUM_MFCC).fill(0),
      delta: new Array(NUM_MFCC).fill(0),
    };
  }

  const frameSize = frames[0].length;
  const window = hannWindow(frameSize);
  const filterbank = melFilterbank(NUM_MEL_FILTERS, frameSize, sampleRate, 0, sampleRate / 2);

  const allMfccs: number[][] = [];

  for (const frame of frames) {
    const windowed = applyWindow(frame, window);
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

    const mfccs = dct(melEnergies, NUM_MFCC);
    allMfccs.push(Array.from(mfccs));
  }

  // Compute mean and variance
  const mfccMean: number[] = [];
  const mfccVariance: number[] = [];
  for (let i = 0; i < NUM_MFCC; i++) {
    const values = allMfccs.map((frame) => frame[i]);
    mfccMean.push(mean(values));
    mfccVariance.push(variance(values));
  }

  // Compute delta (first difference)
  const deltas: number[][] = [];
  for (let t = 1; t < allMfccs.length; t++) {
    const delta: number[] = [];
    for (let i = 0; i < NUM_MFCC; i++) {
      delta.push(allMfccs[t][i] - allMfccs[t - 1][i]);
    }
    deltas.push(delta);
  }

  // Mean of deltas
  const mfccDelta: number[] = [];
  if (deltas.length > 0) {
    for (let i = 0; i < NUM_MFCC; i++) {
      const values = deltas.map((d) => d[i]);
      mfccDelta.push(mean(values));
    }
  } else {
    for (let i = 0; i < NUM_MFCC; i++) {
      mfccDelta.push(0);
    }
  }

  return {
    mean: mfccMean,
    variance: mfccVariance,
    delta: mfccDelta,
  };
}

/**
 * Compute noise floor characteristics from RMS per frame
 */
function computeNoiseFloor(frames: Float32Array[]): {
  rmsLevel: number;
  percentile10: number;
  percentile50: number;
  percentile90: number;
} {
  if (frames.length === 0) {
    return {
      rmsLevel: -60,
      percentile10: -60,
      percentile50: -60,
      percentile90: -60,
    };
  }

  const rmsValues = frames.map((frame) => rms(frame));

  return {
    rmsLevel: linearToDb(mean(rmsValues)),
    percentile10: linearToDb(percentile(rmsValues, 10)),
    percentile50: linearToDb(percentile(rmsValues, 50)),
    percentile90: linearToDb(percentile(rmsValues, 90)),
  };
}

/**
 * Compute power variance across frames
 * High variance indicates dynamic audio, low variance indicates steady-state
 */
function computePowerVariance(frames: Float32Array[]): number {
  if (frames.length === 0) return 0;

  const powers = frames.map((frame) => {
    let power = 0;
    for (let i = 0; i < frame.length; i++) {
      power += frame[i] * frame[i];
    }
    return power / frame.length;
  });

  return variance(powers);
}

/**
 * Compile all ambient features into a single vector
 */
function compileAmbientFeatureVector(features: {
  spectralStats: {
    centroidMean: number;
    centroidStd: number;
    rolloffMean: number;
    rolloffStd: number;
    fluxMean: number;
    fluxStd: number;
    flatnessMean: number;
    flatnessStd: number;
  };
  mfccFeatures: {
    mean: number[];
    variance: number[];
    delta: number[];
  };
  noiseFloor: {
    rmsLevel: number;
    percentile10: number;
    percentile50: number;
    percentile90: number;
  };
  octaveBands: number[];
  powerVariance: number;
  hvacPeaks: number[];
  autocorrelationPeaks: number[];
}): number[] {
  const vector: number[] = [];

  // Spectral stats (8)
  vector.push(features.spectralStats.centroidMean);
  vector.push(features.spectralStats.centroidStd);
  vector.push(features.spectralStats.rolloffMean);
  vector.push(features.spectralStats.rolloffStd);
  vector.push(features.spectralStats.fluxMean);
  vector.push(features.spectralStats.fluxStd);
  vector.push(features.spectralStats.flatnessMean);
  vector.push(features.spectralStats.flatnessStd);

  // MFCC mean (13)
  vector.push(...features.mfccFeatures.mean);

  // MFCC variance (13)
  vector.push(...features.mfccFeatures.variance);

  // MFCC delta (13)
  vector.push(...features.mfccFeatures.delta);

  // Noise floor (4)
  vector.push(features.noiseFloor.rmsLevel / 60);  // Normalize
  vector.push(features.noiseFloor.percentile10 / 60);
  vector.push(features.noiseFloor.percentile50 / 60);
  vector.push(features.noiseFloor.percentile90 / 60);

  // Octave bands (10)
  vector.push(...features.octaveBands.map(v => v / 60));  // Normalize dB

  // Power variance (1)
  vector.push(features.powerVariance);

  // HVAC peaks (6)
  vector.push(...features.hvacPeaks.map(v => v / 60));  // Normalize dB

  // Autocorrelation peaks (5)
  vector.push(...features.autocorrelationPeaks);

  // Ensure correct length
  while (vector.length < AMBIENT_FEATURE_LENGTH) {
    vector.push(0);
  }

  return vector.slice(0, AMBIENT_FEATURE_LENGTH);
}

/**
 * Extract ambient features from capture result
 */
export function extractAmbientFeaturesFromCapture(
  audio: Float32Array,
  sampleRate: number
): AmbientFeatureVector {
  return extractAmbientFeatures(audio, sampleRate);
}
