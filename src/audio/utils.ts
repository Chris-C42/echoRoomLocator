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
  const max = Math.max(...signal.map(Math.abs));
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
