/**
 * MultiModalTrainer - Training pipeline for multi-modal room classifier
 *
 * Handles:
 * - Separate training for chirp and ambient encoders
 * - Shared classifier weights updated by both
 * - Class weight computation for imbalanced data
 * - Training with early stopping
 * - Progress callbacks for UI updates
 */

import * as tf from '@tensorflow/tfjs';
import {
  MultiModalTrainingConfig,
  DEFAULT_MULTIMODAL_TRAINING_CONFIG,
  TrainingProgress,
  TrainingResult,
  TrainingProgressCallback,
  MultiModalTrainingData,
} from './types';
import { MultiModalClassifier } from './MultiModalClassifier';
import { FeatureNormalizer } from './FeatureNormalizer';

export class MultiModalTrainer {
  private config: MultiModalTrainingConfig;
  private progressCallback?: TrainingProgressCallback;

  constructor(config?: Partial<MultiModalTrainingConfig>) {
    this.config = {
      ...DEFAULT_MULTIMODAL_TRAINING_CONFIG,
      ...config,
    };
  }

  /**
   * Set progress callback for UI updates
   */
  onProgress(callback: TrainingProgressCallback): void {
    this.progressCallback = callback;
  }

  /**
   * Report progress to callback
   */
  private reportProgress(progress: TrainingProgress): void {
    if (this.progressCallback) {
      this.progressCallback(progress);
    }
  }

  /**
   * Prepare training data for a specific modality
   */
  prepareModalityData(
    features: number[][],
    labels: string[],
    roomLabels: string[]
  ): {
    normalizer: FeatureNormalizer;
    normalized: number[][];
    labelIndices: number[];
  } {
    // Fit normalizer and transform features
    const normalizer = new FeatureNormalizer();
    const normalized = normalizer.fitTransform(features);

    // Convert labels to indices
    const labelIndices = labels.map((label) => roomLabels.indexOf(label));

    return {
      normalizer,
      normalized,
      labelIndices,
    };
  }

  /**
   * Augment training data by adding Gaussian noise
   */
  private augmentData(
    features: number[][],
    labelIndices: number[]
  ): { features: number[][]; labelIndices: number[] } {
    const augmentedFeatures: number[][] = [...features];
    const augmentedLabels: number[] = [...labelIndices];
    const noiseStd = this.config.augmentation.noiseStd;

    // Add 1 augmented copy per original sample
    for (let i = 0; i < features.length; i++) {
      const noisy = features[i].map(
        (val) => val + (Math.random() - 0.5) * 2 * noiseStd
      );
      augmentedFeatures.push(noisy);
      augmentedLabels.push(labelIndices[i]);
    }

    return { features: augmentedFeatures, labelIndices: augmentedLabels };
  }

  /**
   * Compute class weights for imbalanced data
   */
  computeClassWeights(
    labels: string[],
    roomLabels: string[]
  ): { [key: number]: number } {
    const counts = new Map<string, number>();
    for (const label of labels) {
      counts.set(label, (counts.get(label) || 0) + 1);
    }

    const totalSamples = labels.length;
    const numClasses = roomLabels.length;
    const weights: { [key: number]: number } = {};

    for (let i = 0; i < roomLabels.length; i++) {
      const count = counts.get(roomLabels[i]) || 1;
      weights[i] = totalSamples / (numClasses * count);
    }

    return weights;
  }

  /**
   * Train the multi-modal classifier
   */
  async train(
    classifier: MultiModalClassifier,
    data: MultiModalTrainingData
  ): Promise<TrainingResult> {
    const {
      chirpFeatures,
      chirpLabels,
      ambientFeatures,
      ambientLabels,
      roomLabels,
    } = data;

    const hasChirp = chirpFeatures.length > 0;
    const hasAmbient = ambientFeatures.length > 0;

    if (!hasChirp && !hasAmbient) {
      return {
        success: false,
        finalAccuracy: 0,
        finalLoss: 0,
        epochs: 0,
        history: { loss: [], accuracy: [], valLoss: [], valAccuracy: [] },
        error: 'No training data provided',
      };
    }

    try {
      this.reportProgress({
        epoch: 0,
        totalEpochs: this.config.epochs,
        loss: 0,
        accuracy: 0,
        phase: 'preparing',
        message: 'Preparing training data...',
      });

      // Prepare chirp data
      let chirpNormalizer: FeatureNormalizer | null = null;
      let chirpNormalized: number[][] = [];
      let chirpLabelIndices: number[] = [];

      if (hasChirp) {
        const prepared = this.prepareModalityData(
          chirpFeatures,
          chirpLabels,
          roomLabels
        );
        chirpNormalizer = prepared.normalizer;
        chirpNormalized = prepared.normalized;
        chirpLabelIndices = prepared.labelIndices;

        if (this.config.augmentation.enabled) {
          const aug = this.augmentData(chirpNormalized, chirpLabelIndices);
          chirpNormalized = aug.features;
          chirpLabelIndices = aug.labelIndices;
        }
      }

      // Prepare ambient data
      let ambientNormalizer: FeatureNormalizer | null = null;
      let ambientNormalized: number[][] = [];
      let ambientLabelIndices: number[] = [];

      if (hasAmbient) {
        const prepared = this.prepareModalityData(
          ambientFeatures,
          ambientLabels,
          roomLabels
        );
        ambientNormalizer = prepared.normalizer;
        ambientNormalized = prepared.normalized;
        ambientLabelIndices = prepared.labelIndices;

        if (this.config.augmentation.enabled) {
          const aug = this.augmentData(ambientNormalized, ambientLabelIndices);
          ambientNormalized = aug.features;
          ambientLabelIndices = aug.labelIndices;
        }
      }

      // Build model
      classifier.buildModel(roomLabels.length);
      classifier.setNormalizers(
        chirpNormalizer || new FeatureNormalizer(),
        ambientNormalizer || undefined
      );

      // Get pipelines
      const chirpPipeline = classifier.getTrainingPipeline('chirp');
      const ambientPipeline = classifier.getTrainingPipeline('ambient');

      // Create tensors
      const numClasses = roomLabels.length;

      let chirpX: tf.Tensor2D | null = null;
      let chirpY: tf.Tensor2D | null = null;
      if (hasChirp && chirpNormalized.length > 0) {
        chirpX = tf.tensor2d(chirpNormalized);
        chirpY = tf.oneHot(tf.tensor1d(chirpLabelIndices, 'int32'), numClasses) as tf.Tensor2D;
      }

      let ambientX: tf.Tensor2D | null = null;
      let ambientY: tf.Tensor2D | null = null;
      if (hasAmbient && ambientNormalized.length > 0) {
        ambientX = tf.tensor2d(ambientNormalized);
        ambientY = tf.oneHot(tf.tensor1d(ambientLabelIndices, 'int32'), numClasses) as tf.Tensor2D;
      }

      // Compute class weights
      let chirpClassWeights: { [key: number]: number } | undefined;
      let ambientClassWeights: { [key: number]: number } | undefined;

      if (this.config.classWeights) {
        if (hasChirp) {
          chirpClassWeights = this.computeClassWeights(chirpLabels, roomLabels);
        }
        if (hasAmbient) {
          ambientClassWeights = this.computeClassWeights(ambientLabels, roomLabels);
        }
      }

      // Training history
      const history = {
        loss: [] as number[],
        accuracy: [] as number[],
        valLoss: [] as number[],
        valAccuracy: [] as number[],
      };

      // Early stopping state
      let bestValLoss = Infinity;
      let patienceCounter = 0;

      this.reportProgress({
        epoch: 0,
        totalEpochs: this.config.epochs,
        loss: 0,
        accuracy: 0,
        phase: 'training',
        message: 'Starting training...',
      });

      // Training loop - alternate between modalities
      for (let epoch = 0; epoch < this.config.epochs; epoch++) {
        let epochLoss = 0;
        let epochAcc = 0;
        let epochValLoss = 0;
        let epochValAcc = 0;
        let trainedModalities = 0;

        // Train chirp pipeline
        if (hasChirp && chirpPipeline && chirpX && chirpY) {
          const result = await chirpPipeline.fit(chirpX, chirpY, {
            epochs: 1,
            batchSize: this.config.batchSize,
            validationSplit: this.config.validationSplit,
            classWeight: chirpClassWeights,
            shuffle: true,
            verbose: 0,
          });

          epochLoss += (result.history.loss[0] as number) * this.config.modalityWeights.chirp;
          epochAcc += (result.history.acc[0] as number) * this.config.modalityWeights.chirp;
          if (result.history.val_loss) {
            epochValLoss += (result.history.val_loss[0] as number) * this.config.modalityWeights.chirp;
            epochValAcc += (result.history.val_acc[0] as number) * this.config.modalityWeights.chirp;
          }
          trainedModalities += this.config.modalityWeights.chirp;
        }

        // Train ambient pipeline
        if (hasAmbient && ambientPipeline && ambientX && ambientY) {
          const result = await ambientPipeline.fit(ambientX, ambientY, {
            epochs: 1,
            batchSize: this.config.batchSize,
            validationSplit: this.config.validationSplit,
            classWeight: ambientClassWeights,
            shuffle: true,
            verbose: 0,
          });

          epochLoss += (result.history.loss[0] as number) * this.config.modalityWeights.ambient;
          epochAcc += (result.history.acc[0] as number) * this.config.modalityWeights.ambient;
          if (result.history.val_loss) {
            epochValLoss += (result.history.val_loss[0] as number) * this.config.modalityWeights.ambient;
            epochValAcc += (result.history.val_acc[0] as number) * this.config.modalityWeights.ambient;
          }
          trainedModalities += this.config.modalityWeights.ambient;
        }

        // Average metrics
        if (trainedModalities > 0) {
          epochLoss /= trainedModalities;
          epochAcc /= trainedModalities;
          epochValLoss /= trainedModalities;
          epochValAcc /= trainedModalities;
        }

        // Update history
        history.loss.push(epochLoss);
        history.accuracy.push(epochAcc);
        if (epochValLoss > 0) history.valLoss.push(epochValLoss);
        if (epochValAcc > 0) history.valAccuracy.push(epochValAcc);

        // Report progress
        this.reportProgress({
          epoch: epoch + 1,
          totalEpochs: this.config.epochs,
          loss: epochLoss,
          accuracy: epochAcc,
          valLoss: epochValLoss > 0 ? epochValLoss : undefined,
          valAccuracy: epochValAcc > 0 ? epochValAcc : undefined,
          phase: 'training',
        });

        // Early stopping
        if (epochValLoss > 0) {
          if (epochValLoss < bestValLoss - this.config.earlyStopping.minDelta) {
            bestValLoss = epochValLoss;
            patienceCounter = 0;
          } else {
            patienceCounter++;
            if (patienceCounter >= this.config.earlyStopping.patience) {
              this.reportProgress({
                epoch: epoch + 1,
                totalEpochs: this.config.epochs,
                loss: epochLoss,
                accuracy: epochAcc,
                valLoss: epochValLoss,
                valAccuracy: epochValAcc,
                phase: 'complete',
                message: `Early stopping at epoch ${epoch + 1}`,
              });
              break;
            }
          }
        }
      }

      // Clean up tensors
      chirpX?.dispose();
      chirpY?.dispose();
      ambientX?.dispose();
      ambientY?.dispose();

      const finalAccuracy = history.valAccuracy.length > 0
        ? history.valAccuracy[history.valAccuracy.length - 1]
        : history.accuracy[history.accuracy.length - 1];

      const finalLoss = history.valLoss.length > 0
        ? history.valLoss[history.valLoss.length - 1]
        : history.loss[history.loss.length - 1];

      this.reportProgress({
        epoch: history.loss.length,
        totalEpochs: this.config.epochs,
        loss: finalLoss,
        accuracy: finalAccuracy,
        phase: 'complete',
        message: `Training complete! Accuracy: ${(finalAccuracy * 100).toFixed(1)}%`,
      });

      // Initialize classifier with room labels
      classifier.initialize(
        roomLabels,
        chirpNormalizer || new FeatureNormalizer(),
        ambientNormalizer || undefined
      );

      return {
        success: true,
        finalAccuracy,
        finalLoss,
        epochs: history.loss.length,
        history,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.reportProgress({
        epoch: 0,
        totalEpochs: this.config.epochs,
        loss: 0,
        accuracy: 0,
        phase: 'error',
        message: `Training failed: ${errorMessage}`,
      });

      return {
        success: false,
        finalAccuracy: 0,
        finalLoss: 0,
        epochs: 0,
        history: {
          loss: [],
          accuracy: [],
          valLoss: [],
          valAccuracy: [],
        },
        error: errorMessage,
      };
    }
  }
}
