/**
 * MultiModalClassifier - Dual-encoder model for multi-modal room classification
 *
 * Architecture:
 * - ChirpEncoder: chirp features (63) → embedding (32)
 * - AmbientEncoder: ambient features (76) → embedding (32)
 * - SharedClassifier: embedding (32) → classes (N)
 *
 * Both encoders map to the same embedding space, allowing:
 * - Training with either chirp or ambient samples
 * - Prediction using either modality
 * - Future: cross-modal learning
 */

import * as tf from '@tensorflow/tfjs';
import {
  MultiModalModelConfig,
  DEFAULT_MULTIMODAL_CONFIG,
  EncoderType,
  MultiModalPredictionResult,
} from './types';
import { FeatureNormalizer } from './FeatureNormalizer';
import { computeConfidenceMetrics } from './ConfidenceEstimator';

export class MultiModalClassifier {
  // Model components
  private chirpEncoder: tf.LayersModel | null = null;
  private ambientEncoder: tf.LayersModel | null = null;
  private classifier: tf.LayersModel | null = null;

  // Combined models for training (encoder + classifier)
  private chirpPipeline: tf.LayersModel | null = null;
  private ambientPipeline: tf.LayersModel | null = null;

  // Normalizers (separate for each modality)
  private chirpNormalizer: FeatureNormalizer | null = null;
  private ambientNormalizer: FeatureNormalizer | null = null;

  private roomLabels: string[] = [];
  private config: MultiModalModelConfig;
  private isReady: boolean = false;

  constructor(config?: Partial<MultiModalModelConfig>) {
    this.config = {
      ...DEFAULT_MULTIMODAL_CONFIG,
      numClasses: config?.numClasses ?? 2,
      ...config,
    };
  }

  /**
   * Build the multi-modal model architecture
   */
  buildModel(numClasses: number): void {
    this.config.numClasses = numClasses;
    const {
      chirpInputSize,
      ambientInputSize,
      chirpEncoderLayers,
      ambientEncoderLayers,
      embeddingSize,
      classifierLayers,
      dropoutRates,
      learningRate,
    } = this.config;

    // Build Chirp Encoder
    const chirpInput = tf.input({ shape: [chirpInputSize], name: 'chirp_input' });
    let chirpX: tf.SymbolicTensor = chirpInput;

    for (let i = 0; i < chirpEncoderLayers.length; i++) {
      chirpX = tf.layers.dense({
        units: chirpEncoderLayers[i],
        activation: 'relu',
        kernelInitializer: 'heNormal',
        name: `chirp_dense_${i}`,
      }).apply(chirpX) as tf.SymbolicTensor;

      if (dropoutRates[i] && dropoutRates[i] > 0) {
        chirpX = tf.layers.dropout({
          rate: dropoutRates[i],
          name: `chirp_dropout_${i}`,
        }).apply(chirpX) as tf.SymbolicTensor;
      }
    }

    const chirpEmbedding = tf.layers.dense({
      units: embeddingSize,
      activation: 'relu',
      kernelInitializer: 'heNormal',
      name: 'chirp_embedding',
    }).apply(chirpX) as tf.SymbolicTensor;

    this.chirpEncoder = tf.model({
      inputs: chirpInput,
      outputs: chirpEmbedding,
      name: 'chirp_encoder',
    });

    // Build Ambient Encoder
    const ambientInput = tf.input({ shape: [ambientInputSize], name: 'ambient_input' });
    let ambientX: tf.SymbolicTensor = ambientInput;

    for (let i = 0; i < ambientEncoderLayers.length; i++) {
      ambientX = tf.layers.dense({
        units: ambientEncoderLayers[i],
        activation: 'relu',
        kernelInitializer: 'heNormal',
        name: `ambient_dense_${i}`,
      }).apply(ambientX) as tf.SymbolicTensor;

      if (dropoutRates[i] && dropoutRates[i] > 0) {
        ambientX = tf.layers.dropout({
          rate: dropoutRates[i],
          name: `ambient_dropout_${i}`,
        }).apply(ambientX) as tf.SymbolicTensor;
      }
    }

    const ambientEmbedding = tf.layers.dense({
      units: embeddingSize,
      activation: 'relu',
      kernelInitializer: 'heNormal',
      name: 'ambient_embedding',
    }).apply(ambientX) as tf.SymbolicTensor;

    this.ambientEncoder = tf.model({
      inputs: ambientInput,
      outputs: ambientEmbedding,
      name: 'ambient_encoder',
    });

    // Build Shared Classifier
    const classifierInput = tf.input({ shape: [embeddingSize], name: 'embedding_input' });
    let classifierX: tf.SymbolicTensor = classifierInput;

    for (let i = 0; i < classifierLayers.length; i++) {
      classifierX = tf.layers.dense({
        units: classifierLayers[i],
        activation: 'relu',
        kernelInitializer: 'heNormal',
        name: `classifier_dense_${i}`,
      }).apply(classifierX) as tf.SymbolicTensor;

      const dropoutIdx = chirpEncoderLayers.length + i;
      if (dropoutRates[dropoutIdx] && dropoutRates[dropoutIdx] > 0) {
        classifierX = tf.layers.dropout({
          rate: dropoutRates[dropoutIdx],
          name: `classifier_dropout_${i}`,
        }).apply(classifierX) as tf.SymbolicTensor;
      }
    }

    const classifierOutput = tf.layers.dense({
      units: numClasses,
      activation: 'softmax',
      kernelInitializer: 'glorotNormal',
      name: 'classifier_output',
    }).apply(classifierX) as tf.SymbolicTensor;

    this.classifier = tf.model({
      inputs: classifierInput,
      outputs: classifierOutput,
      name: 'shared_classifier',
    });

    // Build combined pipelines for training
    // Chirp pipeline: chirp input → encoder → classifier
    const chirpPipelineOutput = this.classifier.apply(
      this.chirpEncoder.apply(chirpInput)
    ) as tf.SymbolicTensor;

    this.chirpPipeline = tf.model({
      inputs: chirpInput,
      outputs: chirpPipelineOutput,
      name: 'chirp_pipeline',
    });

    this.chirpPipeline.compile({
      optimizer: tf.train.adam(learningRate),
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy'],
    });

    // Ambient pipeline: ambient input → encoder → classifier
    const ambientPipelineOutput = this.classifier.apply(
      this.ambientEncoder.apply(ambientInput)
    ) as tf.SymbolicTensor;

    this.ambientPipeline = tf.model({
      inputs: ambientInput,
      outputs: ambientPipelineOutput,
      name: 'ambient_pipeline',
    });

    this.ambientPipeline.compile({
      optimizer: tf.train.adam(learningRate),
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy'],
    });

    console.log('[MultiModalClassifier] Models built');
    console.log('  Chirp encoder:', this.chirpEncoder.countParams(), 'params');
    console.log('  Ambient encoder:', this.ambientEncoder.countParams(), 'params');
    console.log('  Classifier:', this.classifier.countParams(), 'params');
  }

  /**
   * Initialize with room labels and normalizers
   */
  initialize(
    roomLabels: string[],
    chirpNormalizer: FeatureNormalizer,
    ambientNormalizer?: FeatureNormalizer
  ): void {
    this.roomLabels = roomLabels;
    this.chirpNormalizer = chirpNormalizer;
    this.ambientNormalizer = ambientNormalizer || null;
    this.config.numClasses = roomLabels.length;

    if (!this.chirpEncoder || !this.ambientEncoder || !this.classifier) {
      this.buildModel(roomLabels.length);
    }

    this.isReady = true;
  }

  /**
   * Get the training pipeline for a specific modality
   */
  getTrainingPipeline(mode: EncoderType): tf.LayersModel | null {
    return mode === 'chirp' ? this.chirpPipeline : this.ambientPipeline;
  }

  /**
   * Predict room from features
   */
  async predict(
    features: number[],
    mode: EncoderType
  ): Promise<MultiModalPredictionResult> {
    if (!this.isReady) {
      throw new Error('Classifier not initialized');
    }

    const normalizer = mode === 'chirp' ? this.chirpNormalizer : this.ambientNormalizer;
    const encoder = mode === 'chirp' ? this.chirpEncoder : this.ambientEncoder;

    if (!normalizer || !encoder || !this.classifier) {
      throw new Error(`${mode} encoder or normalizer not available`);
    }

    // Normalize features
    const normalized = normalizer.transform(features);

    // Get embedding
    const inputTensor = tf.tensor2d([normalized]);
    const embeddingTensor = encoder.predict(inputTensor) as tf.Tensor;
    const embedding = await embeddingTensor.data();

    // Classify
    const outputTensor = this.classifier.predict(embeddingTensor) as tf.Tensor;
    const probabilities = await outputTensor.data();

    // Clean up
    inputTensor.dispose();
    embeddingTensor.dispose();
    outputTensor.dispose();

    // Find predicted class
    let maxProb = 0;
    let maxIdx = 0;
    const allProbabilities = new Map<string, number>();

    for (let i = 0; i < probabilities.length; i++) {
      const prob = probabilities[i];
      allProbabilities.set(this.roomLabels[i], prob);

      if (prob > maxProb) {
        maxProb = prob;
        maxIdx = i;
      }
    }

    const confidenceMetrics = computeConfidenceMetrics(Array.from(probabilities));

    return {
      predictedRoomId: this.roomLabels[maxIdx],
      confidence: maxProb,
      allProbabilities,
      isLowConfidence: confidenceMetrics.isLowConfidence,
      entropy: confidenceMetrics.entropy,
      encoderUsed: mode,
      embeddingVector: Array.from(embedding),
    };
  }

  /**
   * Get room labels
   */
  getRoomLabels(): string[] {
    return [...this.roomLabels];
  }

  /**
   * Get normalizers
   */
  getChirpNormalizer(): FeatureNormalizer | null {
    return this.chirpNormalizer;
  }

  getAmbientNormalizer(): FeatureNormalizer | null {
    return this.ambientNormalizer;
  }

  /**
   * Set normalizers (used by trainer)
   */
  setNormalizers(
    chirpNormalizer: FeatureNormalizer,
    ambientNormalizer?: FeatureNormalizer
  ): void {
    this.chirpNormalizer = chirpNormalizer;
    this.ambientNormalizer = ambientNormalizer || null;
  }

  /**
   * Check if ready
   */
  ready(): boolean {
    return this.isReady;
  }

  /**
   * Serialize all model components
   */
  async serialize(): Promise<{
    chirpEncoderTopology: unknown;
    chirpEncoderWeights: ArrayBuffer;
    ambientEncoderTopology: unknown;
    ambientEncoderWeights: ArrayBuffer;
    classifierTopology: unknown;
    classifierWeights: ArrayBuffer;
  }> {
    if (!this.chirpEncoder || !this.ambientEncoder || !this.classifier) {
      throw new Error('Models not built');
    }

    const serializeModel = async (model: tf.LayersModel) => {
      const topology = model.toJSON();
      const weights = await model.getWeights();

      const weightArrays: Float32Array[] = [];
      for (const tensor of weights) {
        const data = await tensor.data();
        weightArrays.push(new Float32Array(data));
      }

      const totalLength = weightArrays.reduce((sum, arr) => sum + arr.length, 0);
      const concatenated = new Float32Array(totalLength);
      let offset = 0;
      for (const arr of weightArrays) {
        concatenated.set(arr, offset);
        offset += arr.length;
      }

      return { topology, weights: concatenated.buffer };
    };

    const [chirp, ambient, classifier] = await Promise.all([
      serializeModel(this.chirpEncoder),
      serializeModel(this.ambientEncoder),
      serializeModel(this.classifier),
    ]);

    return {
      chirpEncoderTopology: chirp.topology,
      chirpEncoderWeights: chirp.weights,
      ambientEncoderTopology: ambient.topology,
      ambientEncoderWeights: ambient.weights,
      classifierTopology: classifier.topology,
      classifierWeights: classifier.weights,
    };
  }

  /**
   * Deserialize from stored data
   */
  async deserialize(
    data: {
      chirpEncoderTopology: unknown;
      chirpEncoderWeights: ArrayBuffer;
      ambientEncoderTopology: unknown;
      ambientEncoderWeights: ArrayBuffer;
      classifierTopology: unknown;
      classifierWeights: ArrayBuffer;
    },
    roomLabels: string[],
    chirpNormalizerParams: { mean: number[]; std: number[]; featureCount: number },
    ambientNormalizerParams?: { mean: number[]; std: number[]; featureCount: number }
  ): Promise<void> {
    const loadModel = async (
      topology: unknown,
      weights: ArrayBuffer
    ): Promise<tf.LayersModel> => {
      let parsed = topology;
      if (typeof topology === 'string') {
        parsed = JSON.parse(topology);
      }

      const modelJSON = (parsed as Record<string, unknown>).modelTopology
        ? parsed
        : { modelTopology: parsed };

      const model = await tf.models.modelFromJSON(modelJSON as tf.io.ModelJSON);

      // Set weights
      const weightData = new Float32Array(weights);
      const modelWeights = model.getWeights();
      let offset = 0;
      const newWeights: tf.Tensor[] = [];

      for (const tensor of modelWeights) {
        const shape = tensor.shape;
        const size = shape.reduce((a, b) => a * b, 1);
        const weightSlice = weightData.slice(offset, offset + size);
        newWeights.push(tf.tensor(weightSlice, shape));
        offset += size;
      }

      model.setWeights(newWeights);

      // Dispose temporary tensors
      for (const t of newWeights) {
        t.dispose();
      }

      return model;
    };

    // Load all models
    [this.chirpEncoder, this.ambientEncoder, this.classifier] = await Promise.all([
      loadModel(data.chirpEncoderTopology, data.chirpEncoderWeights),
      loadModel(data.ambientEncoderTopology, data.ambientEncoderWeights),
      loadModel(data.classifierTopology, data.classifierWeights),
    ]);

    // Set labels and normalizers
    this.roomLabels = roomLabels;
    this.chirpNormalizer = FeatureNormalizer.fromParams(chirpNormalizerParams);
    this.ambientNormalizer = ambientNormalizerParams
      ? FeatureNormalizer.fromParams(ambientNormalizerParams)
      : null;

    this.config.numClasses = roomLabels.length;
    this.isReady = true;

    console.log('[MultiModalClassifier] Deserialized successfully');
  }

  /**
   * Dispose TensorFlow resources
   */
  dispose(): void {
    this.chirpEncoder?.dispose();
    this.ambientEncoder?.dispose();
    this.classifier?.dispose();
    this.chirpPipeline?.dispose();
    this.ambientPipeline?.dispose();

    this.chirpEncoder = null;
    this.ambientEncoder = null;
    this.classifier = null;
    this.chirpPipeline = null;
    this.ambientPipeline = null;
    this.isReady = false;
  }
}
