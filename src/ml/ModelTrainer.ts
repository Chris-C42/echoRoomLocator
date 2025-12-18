/**
 * ModelTrainer - Training pipeline for room classifier
 *
 * Handles:
 * - Data preparation and augmentation
 * - Class weight computation for imbalanced data
 * - Training with early stopping
 * - Progress callbacks for UI updates
 */

import * as tf from '@tensorflow/tfjs';
import {
  TrainingConfig,
  DEFAULT_TRAINING_CONFIG,
  TrainingProgress,
  TrainingResult,
  TrainingProgressCallback,
} from './types';
import { RoomClassifier } from './RoomClassifier';
import { FeatureNormalizer } from './FeatureNormalizer';

export class ModelTrainer {
  private config: TrainingConfig;
  private progressCallback?: TrainingProgressCallback;

  constructor(config?: Partial<TrainingConfig>) {
    this.config = {
      ...DEFAULT_TRAINING_CONFIG,
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
   * Prepare training data
   * - Normalizes features
   * - Applies feature weighting (A4) for orientation robustness
   * - Converts labels to one-hot encoding
   * - Applies data augmentation if enabled
   */
  prepareData(
    features: number[][],
    labels: string[],
    roomLabels: string[]
  ): {
    normalizer: FeatureNormalizer;
    trainX: tf.Tensor2D;
    trainY: tf.Tensor2D;
  } {
    this.reportProgress({
      epoch: 0,
      totalEpochs: this.config.epochs,
      loss: 0,
      accuracy: 0,
      phase: 'preparing',
      message: 'Normalizing features...',
    });

    // Fit normalizer and transform features
    const normalizer = new FeatureNormalizer();
    const normalizedFeatures = normalizer.fitTransform(features);

    // Apply feature weighting (A4) for orientation robustness
    let weightedFeatures = normalizedFeatures;
    if (this.config.featureWeighting.enabled) {
      this.reportProgress({
        epoch: 0,
        totalEpochs: this.config.epochs,
        loss: 0,
        accuracy: 0,
        phase: 'preparing',
        message: 'Applying feature weights...',
      });
      weightedFeatures = this.applyFeatureWeights(normalizedFeatures);
    }

    // Apply data augmentation if enabled
    let augmentedFeatures = weightedFeatures;
    let augmentedLabels = labels;

    if (this.config.augmentation.enabled) {
      this.reportProgress({
        epoch: 0,
        totalEpochs: this.config.epochs,
        loss: 0,
        accuracy: 0,
        phase: 'preparing',
        message: 'Augmenting data...',
      });

      const { features: augFeats, labels: augLabs } = this.augmentData(
        weightedFeatures,
        labels
      );
      augmentedFeatures = augFeats;
      augmentedLabels = augLabs;
    }

    // Convert labels to one-hot encoding
    const labelIndices = augmentedLabels.map((label) =>
      roomLabels.indexOf(label)
    );
    const numClasses = roomLabels.length;

    // Create tensors
    const trainX = tf.tensor2d(augmentedFeatures);
    const trainY = tf.oneHot(tf.tensor1d(labelIndices, 'int32'), numClasses);

    return {
      normalizer,
      trainX,
      trainY: trainY as tf.Tensor2D,
    };
  }

  /**
   * Apply feature weighting (A4) for orientation robustness
   * Late reverb features (orientation-invariant) get higher weight
   * Early reflection features (orientation-sensitive) get lower weight
   */
  private applyFeatureWeights(features: number[][]): number[][] {
    const { lateReverbWeight, earlyReflectionWeight, lateFeatureCount } =
      this.config.featureWeighting;

    return features.map((sample) => {
      return sample.map((value, idx) => {
        // First lateFeatureCount features are late reverb (orientation-invariant)
        // Remaining features are early reflections (orientation-sensitive)
        const weight = idx < lateFeatureCount
          ? lateReverbWeight
          : earlyReflectionWeight;
        return value * weight;
      });
    });
  }

  /**
   * Augment training data by adding Gaussian noise
   */
  private augmentData(
    features: number[][],
    labels: string[]
  ): { features: number[][]; labels: string[] } {
    const augmentedFeatures: number[][] = [...features];
    const augmentedLabels: string[] = [...labels];
    const noiseStd = this.config.augmentation.noiseStd;

    // Add 1 augmented copy per original sample
    for (let i = 0; i < features.length; i++) {
      const noisy = features[i].map(
        (val) => val + (Math.random() - 0.5) * 2 * noiseStd
      );
      augmentedFeatures.push(noisy);
      augmentedLabels.push(labels[i]);
    }

    return { features: augmentedFeatures, labels: augmentedLabels };
  }

  /**
   * Compute class weights for imbalanced data
   */
  computeClassWeights(labels: string[], roomLabels: string[]): { [key: number]: number } {
    const counts = new Map<string, number>();
    for (const label of labels) {
      counts.set(label, (counts.get(label) || 0) + 1);
    }

    const totalSamples = labels.length;
    const numClasses = roomLabels.length;
    const weights: { [key: number]: number } = {};

    for (let i = 0; i < roomLabels.length; i++) {
      const count = counts.get(roomLabels[i]) || 1;
      // Balanced class weight formula
      weights[i] = totalSamples / (numClasses * count);
    }

    return weights;
  }

  /**
   * Train the classifier
   */
  async train(
    classifier: RoomClassifier,
    features: number[][],
    labels: string[],
    roomLabels: string[]
  ): Promise<TrainingResult> {
    try {
      // Prepare data
      const { normalizer, trainX, trainY } = this.prepareData(
        features,
        labels,
        roomLabels
      );

      // Initialize classifier
      classifier.initialize(roomLabels, normalizer);
      const model = classifier.getModel();

      if (!model) {
        throw new Error('Failed to create model');
      }

      // Compute class weights if enabled
      let classWeights: { [key: number]: number } | undefined;
      if (this.config.classWeights) {
        classWeights = this.computeClassWeights(labels, roomLabels);
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

      // Custom training loop for better control
      for (let epoch = 0; epoch < this.config.epochs; epoch++) {
        // Train for one epoch
        const result = await model.fit(trainX, trainY, {
          epochs: 1,
          batchSize: this.config.batchSize,
          validationSplit: this.config.validationSplit,
          classWeight: classWeights,
          shuffle: true,
          verbose: 0,
        });

        const loss = result.history.loss[0] as number;
        const accuracy = result.history.acc[0] as number;
        const valLoss = result.history.val_loss?.[0] as number | undefined;
        const valAccuracy = result.history.val_acc?.[0] as number | undefined;

        // Update history
        history.loss.push(loss);
        history.accuracy.push(accuracy);
        if (valLoss !== undefined) history.valLoss.push(valLoss);
        if (valAccuracy !== undefined) history.valAccuracy.push(valAccuracy);

        // Report progress
        this.reportProgress({
          epoch: epoch + 1,
          totalEpochs: this.config.epochs,
          loss,
          accuracy,
          valLoss,
          valAccuracy,
          phase: 'training',
        });

        // Early stopping check
        if (valLoss !== undefined) {
          if (valLoss < bestValLoss - this.config.earlyStopping.minDelta) {
            bestValLoss = valLoss;
            patienceCounter = 0;
          } else {
            patienceCounter++;
            if (patienceCounter >= this.config.earlyStopping.patience) {
              this.reportProgress({
                epoch: epoch + 1,
                totalEpochs: this.config.epochs,
                loss,
                accuracy,
                valLoss,
                valAccuracy,
                phase: 'complete',
                message: `Early stopping at epoch ${epoch + 1}`,
              });
              break;
            }
          }
        }
      }

      // Clean up tensors
      trainX.dispose();
      trainY.dispose();

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

  /**
   * Evaluate model on test data
   */
  async evaluate(
    classifier: RoomClassifier,
    features: number[][],
    labels: string[]
  ): Promise<{ accuracy: number; confusionMatrix: number[][] }> {
    const roomLabels = classifier.getRoomLabels();
    const numClasses = roomLabels.length;

    // Initialize confusion matrix
    const confusionMatrix: number[][] = Array(numClasses)
      .fill(null)
      .map(() => Array(numClasses).fill(0));

    let correct = 0;

    for (let i = 0; i < features.length; i++) {
      const prediction = await classifier.predict(features[i]);
      const predictedIdx = roomLabels.indexOf(prediction.predictedRoomId);
      const actualIdx = roomLabels.indexOf(labels[i]);

      confusionMatrix[actualIdx][predictedIdx]++;

      if (predictedIdx === actualIdx) {
        correct++;
      }
    }

    return {
      accuracy: correct / features.length,
      confusionMatrix,
    };
  }
}
