/**
 * useSamples - React hook for sample management
 *
 * Provides:
 * - Sample CRUD operations
 * - Sample retrieval by room
 * - Training readiness checks
 */

import { useState, useCallback, useEffect } from 'react';
import {
  Sample,
  SampleFeatures,
  SampleMetadata,
  createSample,
  getSamplesForRoom,
  getAllSamples,
  deleteSample,
  deleteSamplesForRoom,
  canTrain,
  getTrainingData,
} from '../storage';
import {
  analyzeOrientationDiversity,
  OrientationStats,
} from '../utils';

export interface UseSamplesState {
  samples: Sample[];
  isLoading: boolean;
  error: string | null;
  canTrain: boolean;
  trainingMessage: string;
}

export interface TrainingReadiness {
  canTrain: boolean;
  roomCount: number;
  readyRooms: number;
  totalSamples: number;
  message: string;
  // B4: Orientation diversity info
  roomsWithLowDiversity?: string[];
  orientationEnforced?: boolean;
}

export interface UseSamplesReturn {
  state: UseSamplesState;
  addSample: (roomId: string, features: SampleFeatures, metadata: SampleMetadata) => Promise<Sample | null>;
  removeSample: (id: string) => Promise<boolean>;
  removeSamplesForRoom: (roomId: string) => Promise<number>;
  getSamplesForRoom: (roomId: string) => Promise<Sample[]>;
  getOrientationStats: (roomId: string) => Promise<OrientationStats>;
  checkTrainingReadiness: () => Promise<TrainingReadiness>;
  getTrainingData: () => Promise<{ features: number[][]; labels: string[]; roomIds: string[] }>;
  refreshSamples: () => Promise<void>;
}

export function useSamples(): UseSamplesReturn {
  const [state, setState] = useState<UseSamplesState>({
    samples: [],
    isLoading: true,
    error: null,
    canTrain: false,
    trainingMessage: 'Loading...',
  });

  /**
   * Refresh all samples and training readiness
   */
  const refreshSamples = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const [samples, trainability] = await Promise.all([
        getAllSamples(),
        canTrain(),
      ]);

      setState({
        samples,
        isLoading: false,
        error: null,
        canTrain: trainability.canTrain,
        trainingMessage: trainability.message,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load samples';
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: message,
      }));
    }
  }, []);

  // Load samples on mount
  useEffect(() => {
    refreshSamples();
  }, [refreshSamples]);

  /**
   * Add a new sample for a room
   */
  const addSample = useCallback(async (
    roomId: string,
    features: SampleFeatures,
    metadata: SampleMetadata
  ): Promise<Sample | null> => {
    try {
      const sample = await createSample(roomId, features, metadata);

      // Update local state
      setState((prev) => ({
        ...prev,
        samples: [...prev.samples, sample],
        error: null,
      }));

      // Refresh training readiness
      const trainability = await canTrain();
      setState((prev) => ({
        ...prev,
        canTrain: trainability.canTrain,
        trainingMessage: trainability.message,
      }));

      return sample;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save sample';
      setState((prev) => ({ ...prev, error: message }));
      return null;
    }
  }, []);

  /**
   * Remove a sample
   */
  const removeSample = useCallback(async (id: string): Promise<boolean> => {
    try {
      await deleteSample(id);

      // Update local state
      setState((prev) => ({
        ...prev,
        samples: prev.samples.filter((s) => s.id !== id),
        error: null,
      }));

      // Refresh training readiness
      const trainability = await canTrain();
      setState((prev) => ({
        ...prev,
        canTrain: trainability.canTrain,
        trainingMessage: trainability.message,
      }));

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete sample';
      setState((prev) => ({ ...prev, error: message }));
      return false;
    }
  }, []);

  /**
   * Remove all samples for a room
   */
  const removeSamplesForRoomFn = useCallback(async (roomId: string): Promise<number> => {
    try {
      const count = await deleteSamplesForRoom(roomId);

      // Update local state
      setState((prev) => ({
        ...prev,
        samples: prev.samples.filter((s) => s.roomId !== roomId),
        error: null,
      }));

      // Refresh training readiness
      const trainability = await canTrain();
      setState((prev) => ({
        ...prev,
        canTrain: trainability.canTrain,
        trainingMessage: trainability.message,
      }));

      return count;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete samples';
      setState((prev) => ({ ...prev, error: message }));
      return 0;
    }
  }, []);

  /**
   * Get samples for a specific room
   */
  const getSamplesForRoomFn = useCallback(async (roomId: string): Promise<Sample[]> => {
    try {
      return await getSamplesForRoom(roomId);
    } catch (error) {
      console.error('Failed to get samples for room:', error);
      return [];
    }
  }, []);

  /**
   * Get orientation statistics for a room's samples
   */
  const getOrientationStatsFn = useCallback(async (roomId: string): Promise<OrientationStats> => {
    try {
      const samples = await getSamplesForRoom(roomId);
      const orientations = samples.map((s) => s.features.orientation);
      return analyzeOrientationDiversity(orientations);
    } catch (error) {
      console.error('Failed to get orientation stats:', error);
      return analyzeOrientationDiversity([]);
    }
  }, []);

  /**
   * Check training readiness
   * B4: Now includes orientation diversity enforcement
   */
  const checkTrainingReadiness = useCallback(async (): Promise<TrainingReadiness> => {
    const result = await canTrain();
    setState((prev) => ({
      ...prev,
      canTrain: result.canTrain,
      trainingMessage: result.message,
    }));
    return {
      canTrain: result.canTrain,
      roomCount: result.roomCount,
      readyRooms: result.readyRooms,
      totalSamples: result.totalSamples,
      message: result.message,
      roomsWithLowDiversity: result.roomsWithLowDiversity,
      orientationEnforced: result.orientationEnforced,
    };
  }, []);

  /**
   * Get training data (features and labels)
   */
  const getTrainingDataFn = useCallback(async () => {
    return await getTrainingData();
  }, []);

  return {
    state,
    addSample,
    removeSample,
    removeSamplesForRoom: removeSamplesForRoomFn,
    getSamplesForRoom: getSamplesForRoomFn,
    getOrientationStats: getOrientationStatsFn,
    checkTrainingReadiness,
    getTrainingData: getTrainingDataFn,
    refreshSamples,
  };
}
