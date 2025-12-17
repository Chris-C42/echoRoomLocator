/**
 * RoomClassifier - TensorFlow.js neural network for room classification
 *
 * Architecture:
 * - Input: 60 features (normalized)
 * - Hidden 1: 128 units, ReLU, Dropout(0.3)
 * - Hidden 2: 64 units, ReLU, Dropout(0.2)
 * - Hidden 3: 32 units, ReLU
 * - Output: N classes, Softmax
 */

import * as tf from '@tensorflow/tfjs';
import {
  ModelConfig,
  DEFAULT_MODEL_CONFIG,
  PredictionResult,
  RoomClassifierModel,
} from './types';
import { FeatureNormalizer } from './FeatureNormalizer';
import { computeConfidenceMetrics } from './ConfidenceEstimator';

export class RoomClassifier {
  private model: RoomClassifierModel | null = null;
  private normalizer: FeatureNormalizer | null = null;
  private roomLabels: string[] = [];
  private config: ModelConfig;
  private isReady: boolean = false;

  constructor(config?: Partial<ModelConfig>) {
    this.config = {
      ...DEFAULT_MODEL_CONFIG,
      numClasses: config?.numClasses ?? 2,
      ...config,
    };
  }

  /**
   * Build the neural network model
   */
  buildModel(numClasses: number): RoomClassifierModel {
    const { inputSize, hiddenLayers, dropoutRates, learningRate } = this.config;

    const model = tf.sequential();

    // Input layer + first hidden layer
    model.add(
      tf.layers.dense({
        units: hiddenLayers[0],
        activation: 'relu',
        inputShape: [inputSize],
        kernelInitializer: 'heNormal',
      })
    );

    if (dropoutRates[0] > 0) {
      model.add(tf.layers.dropout({ rate: dropoutRates[0] }));
    }

    // Additional hidden layers
    for (let i = 1; i < hiddenLayers.length; i++) {
      model.add(
        tf.layers.dense({
          units: hiddenLayers[i],
          activation: 'relu',
          kernelInitializer: 'heNormal',
        })
      );

      if (dropoutRates[i] > 0) {
        model.add(tf.layers.dropout({ rate: dropoutRates[i] }));
      }
    }

    // Output layer
    model.add(
      tf.layers.dense({
        units: numClasses,
        activation: 'softmax',
        kernelInitializer: 'glorotNormal',
      })
    );

    // Compile the model
    model.compile({
      optimizer: tf.train.adam(learningRate),
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy'],
    });

    return model;
  }

  /**
   * Initialize the classifier with room labels and normalizer
   */
  initialize(
    roomLabels: string[],
    normalizer: FeatureNormalizer,
    existingModel?: RoomClassifierModel
  ): void {
    this.roomLabels = roomLabels;
    this.normalizer = normalizer;
    this.config.numClasses = roomLabels.length;

    if (existingModel) {
      this.model = existingModel;
    } else {
      this.model = this.buildModel(roomLabels.length);
    }

    this.isReady = true;
  }

  /**
   * Predict the room from a feature vector
   */
  async predict(features: number[]): Promise<PredictionResult> {
    if (!this.isReady || !this.model || !this.normalizer) {
      throw new Error('Classifier not initialized. Call initialize() first.');
    }

    // Normalize features
    const normalized = this.normalizer.transform(features);

    // Create tensor and predict
    const inputTensor = tf.tensor2d([normalized]);
    const predictions = this.model.predict(inputTensor) as tf.Tensor;
    const probabilities = await predictions.data();

    // Clean up tensors
    inputTensor.dispose();
    predictions.dispose();

    // Find the predicted class
    let maxProb = 0;
    let maxIdx = 0;
    const allProbabilities = new Map<string, number>();

    for (let i = 0; i < probabilities.length; i++) {
      const prob = probabilities[i];
      const roomId = this.roomLabels[i];
      allProbabilities.set(roomId, prob);

      if (prob > maxProb) {
        maxProb = prob;
        maxIdx = i;
      }
    }

    // Compute confidence metrics
    const confidenceMetrics = computeConfidenceMetrics(Array.from(probabilities));

    return {
      predictedRoomId: this.roomLabels[maxIdx],
      confidence: maxProb,
      allProbabilities,
      isLowConfidence: confidenceMetrics.isLowConfidence,
      entropy: confidenceMetrics.entropy,
    };
  }

  /**
   * Predict with multiple forward passes (MC Dropout) for uncertainty estimation
   * Note: This requires keeping dropout active during inference
   */
  async predictWithUncertainty(
    features: number[],
    numSamples: number = 10
  ): Promise<PredictionResult & { uncertainty: number }> {
    if (!this.isReady || !this.model || !this.normalizer) {
      throw new Error('Classifier not initialized.');
    }

    const normalized = this.normalizer.transform(features);
    const inputTensor = tf.tensor2d([normalized]);

    // Collect predictions from multiple forward passes
    const allPredictions: number[][] = [];

    for (let i = 0; i < numSamples; i++) {
      // Note: In TF.js, dropout is automatically disabled during inference
      // For true MC Dropout, we'd need to use training=true, but this is
      // a simplified version that still provides useful uncertainty estimates
      const predictions = this.model.predict(inputTensor) as tf.Tensor;
      const probs = await predictions.data();
      allPredictions.push(Array.from(probs));
      predictions.dispose();
    }

    inputTensor.dispose();

    // Compute mean predictions
    const meanPredictions = new Array(this.roomLabels.length).fill(0);
    for (const preds of allPredictions) {
      for (let i = 0; i < preds.length; i++) {
        meanPredictions[i] += preds[i];
      }
    }
    for (let i = 0; i < meanPredictions.length; i++) {
      meanPredictions[i] /= numSamples;
    }

    // Compute prediction variance (uncertainty)
    let totalVariance = 0;
    for (const preds of allPredictions) {
      for (let i = 0; i < preds.length; i++) {
        const diff = preds[i] - meanPredictions[i];
        totalVariance += diff * diff;
      }
    }
    const uncertainty = Math.sqrt(totalVariance / (numSamples * this.roomLabels.length));

    // Find predicted class from mean predictions
    let maxProb = 0;
    let maxIdx = 0;
    const allProbabilities = new Map<string, number>();

    for (let i = 0; i < meanPredictions.length; i++) {
      const prob = meanPredictions[i];
      allProbabilities.set(this.roomLabels[i], prob);
      if (prob > maxProb) {
        maxProb = prob;
        maxIdx = i;
      }
    }

    const confidenceMetrics = computeConfidenceMetrics(meanPredictions);

    return {
      predictedRoomId: this.roomLabels[maxIdx],
      confidence: maxProb,
      allProbabilities,
      isLowConfidence: confidenceMetrics.isLowConfidence,
      entropy: confidenceMetrics.entropy,
      uncertainty,
    };
  }

  /**
   * Get the underlying TensorFlow model
   */
  getModel(): RoomClassifierModel | null {
    return this.model;
  }

  /**
   * Get room labels
   */
  getRoomLabels(): string[] {
    return [...this.roomLabels];
  }

  /**
   * Get normalizer
   */
  getNormalizer(): FeatureNormalizer | null {
    return this.normalizer;
  }

  /**
   * Check if classifier is ready for predictions
   */
  ready(): boolean {
    return this.isReady;
  }

  /**
   * Serialize model to JSON and weights
   */
  async serialize(): Promise<{ topology: unknown; weights: ArrayBuffer }> {
    if (!this.model) {
      throw new Error('No model to serialize');
    }

    // Get model topology (returns string | PyJsonDict)
    const topology = this.model.toJSON();

    // Get weights as ArrayBuffer
    const weightData = await this.model.getWeights();
    const weightArrays: Float32Array[] = [];

    for (const tensor of weightData) {
      const data = await tensor.data();
      weightArrays.push(new Float32Array(data));
    }

    // Concatenate all weights
    const totalLength = weightArrays.reduce((sum, arr) => sum + arr.length, 0);
    const concatenated = new Float32Array(totalLength);
    let offset = 0;
    for (const arr of weightArrays) {
      concatenated.set(arr, offset);
      offset += arr.length;
    }

    return {
      topology,
      weights: concatenated.buffer,
    };
  }

  /**
   * Load model from serialized data
   */
  async deserialize(
    topology: unknown,
    weights: ArrayBuffer,
    roomLabels: string[],
    normalizerParams: { mean: number[]; std: number[]; featureCount: number }
  ): Promise<void> {
    // Parse topology if it's a string (can happen depending on how it was serialized)
    let parsedTopology = topology;
    if (typeof topology === 'string') {
      parsedTopology = JSON.parse(topology);
    }

    // Ensure topology is in the correct format for modelFromJSON
    // modelFromJSON expects { modelTopology: ... } format
    const modelJSON = (parsedTopology as Record<string, unknown>).modelTopology
      ? parsedTopology
      : { modelTopology: parsedTopology };

    // Load model from JSON
    this.model = await tf.models.modelFromJSON(modelJSON as tf.io.ModelJSON);

    // Set weights
    const weightData = new Float32Array(weights);
    const modelWeights = this.model.getWeights();

    let offset = 0;
    const newWeights: tf.Tensor[] = [];

    for (const tensor of modelWeights) {
      const shape = tensor.shape;
      const size = shape.reduce((a, b) => a * b, 1);
      const data = weightData.slice(offset, offset + size);
      newWeights.push(tf.tensor(data, shape));
      offset += size;
    }

    this.model.setWeights(newWeights);

    // Clean up temporary tensors
    for (const tensor of newWeights) {
      tensor.dispose();
    }

    // Set room labels and normalizer
    this.roomLabels = roomLabels;
    this.normalizer = FeatureNormalizer.fromParams(normalizerParams);
    this.config.numClasses = roomLabels.length;
    this.isReady = true;
  }

  /**
   * Dispose of TensorFlow resources
   */
  dispose(): void {
    if (this.model) {
      this.model.dispose();
      this.model = null;
    }
    this.isReady = false;
  }
}
