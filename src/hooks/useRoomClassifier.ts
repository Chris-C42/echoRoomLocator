/**
 * useRoomClassifier - React hook for ML model training and prediction
 *
 * Provides:
 * - Model training with progress updates
 * - Room prediction from features
 * - Model persistence to IndexedDB
 * - Model loading from storage
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  RoomClassifier,
  ModelTrainer,
  TrainingProgress,
  TrainingResult,
  PredictionResult,
} from '../ml';
import {
  saveModel,
  getModel,
  hasModel,
  deleteModel,
} from '../storage';

export type ModelState = 'none' | 'loading' | 'ready' | 'training' | 'error';

export interface UseRoomClassifierState {
  modelState: ModelState;
  isTraining: boolean;
  trainingProgress: TrainingProgress | null;
  lastTrainingResult: TrainingResult | null;
  modelInfo: {
    roomCount: number;
    accuracy: number;
    createdAt: number;
  } | null;
  error: string | null;
}

export interface UseRoomClassifierReturn {
  state: UseRoomClassifierState;
  train: (
    features: number[][],
    labels: string[],
    roomIds: string[]
  ) => Promise<TrainingResult>;
  predict: (features: number[]) => Promise<PredictionResult | null>;
  loadModel: () => Promise<boolean>;
  clearModel: () => Promise<boolean>;
  hasTrainedModel: () => Promise<boolean>;
}

export function useRoomClassifier(): UseRoomClassifierReturn {
  const [state, setState] = useState<UseRoomClassifierState>({
    modelState: 'none',
    isTraining: false,
    trainingProgress: null,
    lastTrainingResult: null,
    modelInfo: null,
    error: null,
  });

  const classifierRef = useRef<RoomClassifier | null>(null);
  const trainerRef = useRef<ModelTrainer | null>(null);
  const isLoadingRef = useRef<boolean>(false);

  /**
   * Load model from IndexedDB storage
   * Defined before useEffect to ensure proper closure capture
   */
  const loadModelFromStorage = useCallback(async (): Promise<boolean> => {
    // Prevent concurrent loads
    if (isLoadingRef.current) {
      console.log('[useRoomClassifier] Load already in progress, skipping');
      return false;
    }

    isLoadingRef.current = true;
    console.log('[useRoomClassifier] Loading model from storage...');
    setState((prev) => ({ ...prev, modelState: 'loading', error: null }));

    try {
      const storedModel = await getModel();

      if (!storedModel) {
        console.log('[useRoomClassifier] No stored model found');
        setState((prev) => ({ ...prev, modelState: 'none' }));
        isLoadingRef.current = false;
        return false;
      }

      console.log('[useRoomClassifier] Found stored model, deserializing...', {
        roomCount: storedModel.roomLabels.length,
        weightsSize: storedModel.weights.byteLength,
      });

      // Create new classifier and deserialize
      const classifier = new RoomClassifier();
      await classifier.deserialize(
        storedModel.topology,
        storedModel.weights,
        storedModel.roomLabels,
        storedModel.normalizer
      );

      classifierRef.current = classifier;

      console.log('[useRoomClassifier] Model loaded successfully');
      setState((prev) => ({
        ...prev,
        modelState: 'ready',
        modelInfo: {
          roomCount: storedModel.roomLabels.length,
          accuracy: storedModel.metadata.accuracy,
          createdAt: storedModel.createdAt,
        },
      }));

      isLoadingRef.current = false;
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load model';
      console.error('[useRoomClassifier] Failed to load model:', error);
      setState((prev) => ({
        ...prev,
        modelState: 'error',
        error: message,
      }));
      isLoadingRef.current = false;
      return false;
    }
  }, []);

  // Initialize trainer and load model on mount
  useEffect(() => {
    trainerRef.current = new ModelTrainer();

    // Check for existing model on mount
    loadModelFromStorage();

    return () => {
      if (classifierRef.current) {
        classifierRef.current.dispose();
      }
    };
  }, [loadModelFromStorage]);

  /**
   * Train a new model
   */
  const train = useCallback(async (
    features: number[][],
    labels: string[],
    roomIds: string[]
  ): Promise<TrainingResult> => {
    setState((prev) => ({
      ...prev,
      modelState: 'training',
      isTraining: true,
      trainingProgress: null,
      lastTrainingResult: null,
      error: null,
    }));

    try {
      // Dispose existing classifier
      if (classifierRef.current) {
        classifierRef.current.dispose();
      }

      // Create new classifier and trainer
      const classifier = new RoomClassifier();
      const trainer = trainerRef.current || new ModelTrainer();

      // Set up progress callback
      trainer.onProgress((progress) => {
        setState((prev) => ({ ...prev, trainingProgress: progress }));
      });

      // Train the model
      const result = await trainer.train(classifier, features, labels, roomIds);

      if (result.success) {
        // Save model to storage
        console.log('[useRoomClassifier] Training successful, serializing model...');
        const { topology, weights } = await classifier.serialize();
        const normalizer = classifier.getNormalizer();

        if (normalizer) {
          console.log('[useRoomClassifier] Saving model to storage...', {
            topologyKeys: Object.keys(topology as object),
            weightsSize: weights.byteLength,
            roomCount: roomIds.length,
          });
          await saveModel(
            topology as object,
            weights,
            roomIds,
            normalizer.getParams(),
            {
              accuracy: result.finalAccuracy,
              loss: result.finalLoss,
              epochs: result.epochs,
              samplesUsed: features.length,
              roomCount: roomIds.length,
            }
          );
          console.log('[useRoomClassifier] Model saved successfully');
        } else {
          console.error('[useRoomClassifier] Warning: normalizer is null, model not saved!');
        }

        classifierRef.current = classifier;

        setState((prev) => ({
          ...prev,
          modelState: 'ready',
          isTraining: false,
          lastTrainingResult: result,
          modelInfo: {
            roomCount: roomIds.length,
            accuracy: result.finalAccuracy,
            createdAt: Date.now(),
          },
        }));
      } else {
        setState((prev) => ({
          ...prev,
          modelState: 'error',
          isTraining: false,
          lastTrainingResult: result,
          error: result.error || 'Training failed',
        }));
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Training failed';
      const failedResult: TrainingResult = {
        success: false,
        finalAccuracy: 0,
        finalLoss: 0,
        epochs: 0,
        history: { loss: [], accuracy: [], valLoss: [], valAccuracy: [] },
        error: message,
      };

      setState((prev) => ({
        ...prev,
        modelState: 'error',
        isTraining: false,
        lastTrainingResult: failedResult,
        error: message,
      }));

      return failedResult;
    }
  }, []);

  /**
   * Predict room from features
   */
  const predict = useCallback(async (features: number[]): Promise<PredictionResult | null> => {
    if (!classifierRef.current || !classifierRef.current.ready()) {
      setState((prev) => ({
        ...prev,
        error: 'No model loaded. Train a model first.',
      }));
      return null;
    }

    try {
      const result = await classifierRef.current.predict(features);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Prediction failed';
      setState((prev) => ({ ...prev, error: message }));
      return null;
    }
  }, []);

  /**
   * Load model from storage (public API)
   */
  const loadModel = useCallback(async (): Promise<boolean> => {
    return loadModelFromStorage();
  }, [loadModelFromStorage]);

  /**
   * Clear the trained model
   */
  const clearModel = useCallback(async (): Promise<boolean> => {
    try {
      await deleteModel();

      if (classifierRef.current) {
        classifierRef.current.dispose();
        classifierRef.current = null;
      }

      setState((prev) => ({
        ...prev,
        modelState: 'none',
        modelInfo: null,
        lastTrainingResult: null,
        error: null,
      }));

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to clear model';
      setState((prev) => ({ ...prev, error: message }));
      return false;
    }
  }, []);

  /**
   * Check if a trained model exists
   */
  const hasTrainedModel = useCallback(async (): Promise<boolean> => {
    return await hasModel();
  }, []);

  return {
    state,
    train,
    predict,
    loadModel,
    clearModel,
    hasTrainedModel,
  };
}
