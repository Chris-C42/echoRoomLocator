/**
 * FeatureNormalizer - Z-score normalization for feature vectors
 *
 * Normalizes features to have zero mean and unit variance,
 * which improves neural network training stability.
 */

import { NormalizerParams } from './types';

export class FeatureNormalizer {
  private mean: number[];
  private std: number[];
  private featureCount: number;
  private fitted: boolean = false;

  constructor(params?: NormalizerParams) {
    if (params) {
      this.mean = params.mean;
      this.std = params.std;
      this.featureCount = params.featureCount;
      this.fitted = true;
    } else {
      this.mean = [];
      this.std = [];
      this.featureCount = 0;
    }
  }

  /**
   * Fit the normalizer to training data
   * Computes mean and standard deviation for each feature
   */
  fit(features: number[][]): void {
    if (features.length === 0) {
      throw new Error('Cannot fit normalizer with empty data');
    }

    this.featureCount = features[0].length;
    const n = features.length;

    // Initialize accumulators
    this.mean = new Array(this.featureCount).fill(0);
    this.std = new Array(this.featureCount).fill(0);

    // Compute mean
    for (const sample of features) {
      for (let i = 0; i < this.featureCount; i++) {
        this.mean[i] += sample[i];
      }
    }
    for (let i = 0; i < this.featureCount; i++) {
      this.mean[i] /= n;
    }

    // Compute standard deviation
    for (const sample of features) {
      for (let i = 0; i < this.featureCount; i++) {
        const diff = sample[i] - this.mean[i];
        this.std[i] += diff * diff;
      }
    }
    for (let i = 0; i < this.featureCount; i++) {
      this.std[i] = Math.sqrt(this.std[i] / n);
      // Prevent division by zero - use 1.0 for constant features
      if (this.std[i] < 1e-10) {
        this.std[i] = 1.0;
      }
    }

    this.fitted = true;
  }

  /**
   * Transform features using fitted parameters
   * z = (x - mean) / std
   */
  transform(features: number[]): number[] {
    if (!this.fitted) {
      throw new Error('Normalizer must be fitted before transform');
    }

    if (features.length !== this.featureCount) {
      throw new Error(
        `Feature count mismatch: expected ${this.featureCount}, got ${features.length}`
      );
    }

    const normalized = new Array(this.featureCount);
    for (let i = 0; i < this.featureCount; i++) {
      normalized[i] = (features[i] - this.mean[i]) / this.std[i];
    }
    return normalized;
  }

  /**
   * Transform multiple samples
   */
  transformBatch(featuresBatch: number[][]): number[][] {
    return featuresBatch.map((features) => this.transform(features));
  }

  /**
   * Fit and transform in one step
   */
  fitTransform(features: number[][]): number[][] {
    this.fit(features);
    return this.transformBatch(features);
  }

  /**
   * Inverse transform - convert normalized values back to original scale
   */
  inverseTransform(normalized: number[]): number[] {
    if (!this.fitted) {
      throw new Error('Normalizer must be fitted before inverse transform');
    }

    const original = new Array(this.featureCount);
    for (let i = 0; i < this.featureCount; i++) {
      original[i] = normalized[i] * this.std[i] + this.mean[i];
    }
    return original;
  }

  /**
   * Get normalizer parameters for serialization
   */
  getParams(): NormalizerParams {
    if (!this.fitted) {
      throw new Error('Normalizer must be fitted before getting params');
    }

    return {
      mean: [...this.mean],
      std: [...this.std],
      featureCount: this.featureCount,
    };
  }

  /**
   * Check if normalizer is fitted
   */
  isFitted(): boolean {
    return this.fitted;
  }

  /**
   * Create a normalizer from saved parameters
   */
  static fromParams(params: NormalizerParams): FeatureNormalizer {
    return new FeatureNormalizer(params);
  }
}
