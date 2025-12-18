/**
 * DSP utilities for audio processing
 * Includes FFT, windowing, and signal processing helpers
 */

/**
 * Compute the next power of 2 greater than or equal to n
 */
export function nextPowerOf2(n: number): number {
  return Math.pow(2, Math.ceil(Math.log2(n)));
}

/**
 * Zero-pad an array to a specific length
 */
export function zeroPad(signal: Float32Array, length: number): Float32Array {
  if (signal.length >= length) {
    return signal.slice(0, length);
  }
  const padded = new Float32Array(length);
  padded.set(signal);
  return padded;
}

/**
 * Hann window function
 */
export function hannWindow(length: number): Float32Array {
  const window = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (length - 1)));
  }
  return window;
}

/**
 * Hamming window function
 */
export function hammingWindow(length: number): Float32Array {
  const window = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    window[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (length - 1));
  }
  return window;
}

/**
 * Apply a window function to a signal
 */
export function applyWindow(signal: Float32Array, window: Float32Array): Float32Array {
  const result = new Float32Array(signal.length);
  const windowLength = Math.min(signal.length, window.length);
  for (let i = 0; i < windowLength; i++) {
    result[i] = signal[i] * window[i];
  }
  return result;
}

/**
 * Complex number representation for FFT
 */
export interface Complex {
  re: number;
  im: number;
}

/**
 * Create a complex number
 */
export function complex(re: number, im: number = 0): Complex {
  return { re, im };
}

/**
 * Complex multiplication
 */
export function complexMul(a: Complex, b: Complex): Complex {
  return {
    re: a.re * b.re - a.im * b.im,
    im: a.re * b.im + a.im * b.re,
  };
}

/**
 * Complex addition
 */
export function complexAdd(a: Complex, b: Complex): Complex {
  return {
    re: a.re + b.re,
    im: a.im + b.im,
  };
}

/**
 * Complex subtraction
 */
export function complexSub(a: Complex, b: Complex): Complex {
  return {
    re: a.re - b.re,
    im: a.im - b.im,
  };
}

/**
 * Complex conjugate
 */
export function complexConj(a: Complex): Complex {
  return { re: a.re, im: -a.im };
}

/**
 * Complex magnitude squared
 */
export function complexMagSq(a: Complex): number {
  return a.re * a.re + a.im * a.im;
}

/**
 * Complex magnitude
 */
export function complexMag(a: Complex): number {
  return Math.sqrt(complexMagSq(a));
}

/**
 * Complex division
 */
export function complexDiv(a: Complex, b: Complex): Complex {
  const denom = complexMagSq(b);
  return {
    re: (a.re * b.re + a.im * b.im) / denom,
    im: (a.im * b.re - a.re * b.im) / denom,
  };
}

/**
 * Cooley-Tukey FFT (radix-2)
 * Input length must be a power of 2
 */
export function fft(input: Complex[]): Complex[] {
  const N = input.length;

  if (N <= 1) {
    return input.slice();
  }

  if ((N & (N - 1)) !== 0) {
    throw new Error('FFT input length must be a power of 2');
  }

  // Bit-reversal permutation
  const output = new Array<Complex>(N);
  const bits = Math.log2(N);

  for (let i = 0; i < N; i++) {
    let reversed = 0;
    for (let j = 0; j < bits; j++) {
      reversed = (reversed << 1) | ((i >> j) & 1);
    }
    output[reversed] = { ...input[i] };
  }

  // Iterative FFT
  for (let size = 2; size <= N; size *= 2) {
    const halfSize = size / 2;
    const angle = (-2 * Math.PI) / size;

    for (let i = 0; i < N; i += size) {
      for (let j = 0; j < halfSize; j++) {
        const w: Complex = {
          re: Math.cos(angle * j),
          im: Math.sin(angle * j),
        };

        const even = output[i + j];
        const odd = complexMul(w, output[i + j + halfSize]);

        output[i + j] = complexAdd(even, odd);
        output[i + j + halfSize] = complexSub(even, odd);
      }
    }
  }

  return output;
}

/**
 * Inverse FFT
 */
export function ifft(input: Complex[]): Complex[] {
  const N = input.length;

  // Conjugate input
  const conjugated = input.map(complexConj);

  // Forward FFT
  const transformed = fft(conjugated);

  // Conjugate and scale
  return transformed.map((c) => ({
    re: c.re / N,
    im: -c.im / N,
  }));
}

/**
 * Real-valued FFT (returns only positive frequencies)
 */
export function rfft(signal: Float32Array): Complex[] {
  const N = nextPowerOf2(signal.length);
  const padded = zeroPad(signal, N);

  // Convert to complex
  const complex: Complex[] = Array.from(padded, (re) => ({ re, im: 0 }));

  return fft(complex);
}

/**
 * Inverse real FFT
 */
export function irfft(spectrum: Complex[]): Float32Array {
  const result = ifft(spectrum);
  return new Float32Array(result.map((c) => c.re));
}

/**
 * Compute power spectrum from FFT result
 */
export function powerSpectrum(fftResult: Complex[]): Float32Array {
  const N = fftResult.length;
  const power = new Float32Array(N / 2 + 1);

  for (let i = 0; i <= N / 2; i++) {
    power[i] = complexMagSq(fftResult[i]) / N;
  }

  return power;
}

/**
 * Convert linear amplitude to decibels
 */
export function linearToDb(value: number, reference: number = 1): number {
  return 20 * Math.log10(Math.max(value, 1e-10) / reference);
}

/**
 * Convert decibels to linear amplitude
 */
export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Root mean square of a signal
 */
export function rms(signal: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < signal.length; i++) {
    sum += signal[i] * signal[i];
  }
  return Math.sqrt(sum / signal.length);
}

/**
 * Normalize a signal to have maximum absolute value of 1
 */
export function normalize(signal: Float32Array): Float32Array {
  // Find max using loop to avoid stack overflow on large arrays
  // (spread operator would exceed call stack on mobile with 100k+ samples)
  let max = 0;
  for (let i = 0; i < signal.length; i++) {
    const absVal = Math.abs(signal[i]);
    if (absVal > max) {
      max = absVal;
    }
  }

  if (max === 0) return signal;

  const normalized = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    normalized[i] = signal[i] / max;
  }
  return normalized;
}

/**
 * Generate mel filterbank
 */
export function melFilterbank(
  numFilters: number,
  fftSize: number,
  sampleRate: number,
  lowFreq: number = 0,
  highFreq?: number
): Float32Array[] {
  highFreq = highFreq ?? sampleRate / 2;

  // Convert Hz to mel
  const hzToMel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
  const melToHz = (mel: number) => 700 * (Math.pow(10, mel / 2595) - 1);

  const lowMel = hzToMel(lowFreq);
  const highMel = hzToMel(highFreq);

  // Create mel points
  const melPoints = new Float32Array(numFilters + 2);
  for (let i = 0; i < numFilters + 2; i++) {
    melPoints[i] = lowMel + (i * (highMel - lowMel)) / (numFilters + 1);
  }

  // Convert back to Hz and then to FFT bins
  const hzPoints = melPoints.map(melToHz);
  const binPoints = hzPoints.map((hz) =>
    Math.floor(((fftSize + 1) * hz) / sampleRate)
  );

  // Create filterbank
  const filterbank: Float32Array[] = [];
  const numBins = fftSize / 2 + 1;

  for (let i = 0; i < numFilters; i++) {
    const filter = new Float32Array(numBins);
    const startBin = binPoints[i];
    const centerBin = binPoints[i + 1];
    const endBin = binPoints[i + 2];

    // Rising edge
    for (let j = startBin; j < centerBin; j++) {
      filter[j] = (j - startBin) / (centerBin - startBin);
    }

    // Falling edge
    for (let j = centerBin; j < endBin; j++) {
      filter[j] = (endBin - j) / (endBin - centerBin);
    }

    filterbank.push(filter);
  }

  return filterbank;
}

/**
 * Apply DCT (Type-II) to compute cepstral coefficients
 */
export function dct(input: Float32Array, numCoeffs?: number): Float32Array {
  const N = input.length;
  numCoeffs = numCoeffs ?? N;
  const output = new Float32Array(numCoeffs);

  for (let k = 0; k < numCoeffs; k++) {
    let sum = 0;
    for (let n = 0; n < N; n++) {
      sum += input[n] * Math.cos((Math.PI * k * (2 * n + 1)) / (2 * N));
    }
    output[k] = sum * Math.sqrt(2 / N);
  }

  // Normalize first coefficient
  output[0] *= Math.SQRT1_2;

  return output;
}

/**
 * Frame a signal into overlapping windows
 */
export function frameSignal(
  signal: Float32Array,
  frameSize: number,
  hopSize: number
): Float32Array[] {
  const frames: Float32Array[] = [];
  let start = 0;

  while (start + frameSize <= signal.length) {
    frames.push(signal.slice(start, start + frameSize));
    start += hopSize;
  }

  return frames;
}

/**
 * Calculate the mean of an array
 */
export function mean(arr: Float32Array | number[]): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
  }
  return sum / arr.length;
}

/**
 * Calculate the variance of an array
 */
export function variance(arr: Float32Array | number[]): number {
  if (arr.length === 0) return 0;
  const m = mean(arr);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    const diff = arr[i] - m;
    sum += diff * diff;
  }
  return sum / arr.length;
}

/**
 * Calculate the standard deviation of an array
 */
export function std(arr: Float32Array | number[]): number {
  return Math.sqrt(variance(arr));
}

/**
 * Calculate a percentile value from a sorted or unsorted array
 * @param arr - Input array
 * @param p - Percentile (0-100)
 */
export function percentile(arr: Float32Array | number[], p: number): number {
  if (arr.length === 0) return 0;
  if (p <= 0) return Math.min(...arr);
  if (p >= 100) return Math.max(...arr);

  // Sort a copy
  const sorted = [...arr].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sorted[lower];
  }

  // Linear interpolation
  const fraction = index - lower;
  return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
}

/**
 * Detect peaks in a spectrum at specific frequencies
 * Used for HVAC/hum detection (50Hz, 60Hz harmonics)
 *
 * @param spectrum - Power spectrum from FFT
 * @param sampleRate - Audio sample rate
 * @param frequencies - Target frequencies to check
 * @param bandwidth - Hz bandwidth around each frequency to search
 */
export function detectPeaksAtFrequencies(
  spectrum: Float32Array,
  sampleRate: number,
  frequencies: number[],
  bandwidth: number = 5
): number[] {
  const fftSize = (spectrum.length - 1) * 2;
  const binWidth = sampleRate / fftSize;

  return frequencies.map((freq) => {
    const centerBin = Math.round(freq / binWidth);
    const halfBins = Math.ceil(bandwidth / binWidth);

    let maxPower = 0;
    for (let i = centerBin - halfBins; i <= centerBin + halfBins; i++) {
      if (i >= 0 && i < spectrum.length) {
        maxPower = Math.max(maxPower, spectrum[i]);
      }
    }

    // Convert to dB, normalized
    return linearToDb(Math.sqrt(maxPower));
  });
}

/**
 * Compute normalized autocorrelation of a signal
 * Returns the first N peaks after lag 0
 *
 * @param signal - Input signal
 * @param maxLag - Maximum lag to compute
 * @param numPeaks - Number of peaks to return
 */
export function autocorrelation(
  signal: Float32Array,
  maxLag: number = 1000,
  numPeaks: number = 5
): number[] {
  const N = signal.length;
  maxLag = Math.min(maxLag, N - 1);

  // Compute autocorrelation
  const ac = new Float32Array(maxLag);
  const signalMean = mean(signal);

  // Normalize signal
  const normalized = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    normalized[i] = signal[i] - signalMean;
  }

  // Variance for normalization
  let variance = 0;
  for (let i = 0; i < N; i++) {
    variance += normalized[i] * normalized[i];
  }

  if (variance === 0) {
    return new Array(numPeaks).fill(0);
  }

  // Compute autocorrelation for each lag
  for (let lag = 0; lag < maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < N - lag; i++) {
      sum += normalized[i] * normalized[i + lag];
    }
    ac[lag] = sum / variance;
  }

  // Find peaks (local maxima after lag 0)
  const peaks: Array<{ lag: number; value: number }> = [];
  const minLag = Math.floor(N * 0.01); // Skip very short lags (noise)

  for (let i = minLag + 1; i < maxLag - 1; i++) {
    if (ac[i] > ac[i - 1] && ac[i] > ac[i + 1] && ac[i] > 0.1) {
      peaks.push({ lag: i, value: ac[i] });
    }
  }

  // Sort by value and take top N
  peaks.sort((a, b) => b.value - a.value);
  const result = peaks.slice(0, numPeaks).map((p) => p.value);

  // Pad with zeros if not enough peaks
  while (result.length < numPeaks) {
    result.push(0);
  }

  return result;
}

/**
 * Compute octave band energies from a power spectrum
 * Standard octave bands with center frequencies from 31.5 Hz to 16 kHz
 */
export function octaveBandEnergies(
  spectrum: Float32Array,
  sampleRate: number,
  centerFrequencies: number[] = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
): number[] {
  const fftSize = (spectrum.length - 1) * 2;
  const binWidth = sampleRate / fftSize;

  return centerFrequencies.map((center) => {
    // Octave band: center / sqrt(2) to center * sqrt(2)
    const lowFreq = center / Math.SQRT2;
    const highFreq = center * Math.SQRT2;

    const lowBin = Math.max(0, Math.floor(lowFreq / binWidth));
    const highBin = Math.min(spectrum.length - 1, Math.ceil(highFreq / binWidth));

    // Sum energy in band
    let energy = 0;
    for (let i = lowBin; i <= highBin; i++) {
      energy += spectrum[i];
    }

    return linearToDb(Math.sqrt(energy));
  });
}
