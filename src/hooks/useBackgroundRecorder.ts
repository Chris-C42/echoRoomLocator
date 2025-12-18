/**
 * useBackgroundRecorder - React hook for continuous ambient recording
 *
 * Provides:
 * - Start/stop background recording
 * - Recording status and statistics
 * - Captured features buffer
 * - Error handling
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  BackgroundRecorder,
  BackgroundRecorderConfig,
  BackgroundRecorderStatus,
  DEFAULT_BACKGROUND_CONFIG,
  isContinuousRecordingSupported,
} from '../audio/BackgroundRecorder';
import { AmbientFeatureVector, AmbientCaptureResult } from '../audio/types';

export interface BackgroundRecorderState {
  isRecording: boolean;
  isSupported: boolean;
  hasWakeLock: boolean;
  captureCount: number;
  lastCaptureTime: number | null;
  error: string | null;
  recentCaptures: Array<{
    features: AmbientFeatureVector;
    timestamp: number;
    orientation?: [number, number, number];
  }>;
}

export interface UseBackgroundRecorderReturn extends BackgroundRecorderState {
  startRecording: (config?: Partial<BackgroundRecorderConfig>) => Promise<void>;
  stopRecording: () => Promise<void>;
  clearCaptures: () => void;
  getRecentFeatures: () => number[][];
  supportDetails: {
    hasWakeLock: boolean;
    hasBatteryApi: boolean;
    reason?: string;
  };
}

const MAX_RECENT_CAPTURES = 50;  // Keep last 50 captures in memory

export function useBackgroundRecorder(
  onCapture?: (features: AmbientFeatureVector, captureResult: AmbientCaptureResult) => void
): UseBackgroundRecorderReturn {
  const recorderRef = useRef<BackgroundRecorder | null>(null);

  const [state, setState] = useState<BackgroundRecorderState>({
    isRecording: false,
    isSupported: true,
    hasWakeLock: false,
    captureCount: 0,
    lastCaptureTime: null,
    error: null,
    recentCaptures: [],
  });

  // Check support on mount
  const supportDetails = isContinuousRecordingSupported();

  useEffect(() => {
    setState(prev => ({
      ...prev,
      isSupported: supportDetails.supported,
    }));
  }, [supportDetails.supported]);

  // Handle capture callback
  const handleCapture = useCallback((
    features: AmbientFeatureVector,
    captureResult: AmbientCaptureResult,
    captureIndex: number
  ) => {
    // Extract normalized orientation if available
    let orientation: [number, number, number] | undefined;
    if (captureResult.orientation) {
      const { alpha, beta, gamma } = captureResult.orientation;
      orientation = [
        (alpha ?? 0) / 360,
        (beta ?? 0) / 180,
        (gamma ?? 0) / 90,
      ];
    }

    setState(prev => {
      const newCaptures = [
        ...prev.recentCaptures,
        {
          features,
          timestamp: captureResult.timestamp,
          orientation,
        },
      ].slice(-MAX_RECENT_CAPTURES);  // Keep only recent

      return {
        ...prev,
        captureCount: captureIndex,
        lastCaptureTime: captureResult.timestamp,
        recentCaptures: newCaptures,
      };
    });

    // Call external callback if provided
    if (onCapture) {
      onCapture(features, captureResult);
    }
  }, [onCapture]);

  // Handle error callback
  const handleError = useCallback((error: Error) => {
    console.error('[useBackgroundRecorder] Error:', error);
    setState(prev => ({
      ...prev,
      error: error.message,
    }));
  }, []);

  // Handle status change
  const handleStatusChange = useCallback((status: BackgroundRecorderStatus) => {
    setState(prev => ({
      ...prev,
      isRecording: status.isRunning,
      hasWakeLock: status.hasWakeLock,
      error: status.error,
    }));
  }, []);

  // Start recording
  const startRecording = useCallback(async (
    config?: Partial<BackgroundRecorderConfig>
  ): Promise<void> => {
    if (recorderRef.current) {
      console.warn('[useBackgroundRecorder] Already recording');
      return;
    }

    setState(prev => ({
      ...prev,
      error: null,
      captureCount: 0,
      recentCaptures: [],
    }));

    recorderRef.current = new BackgroundRecorder(
      {
        onCapture: handleCapture,
        onError: handleError,
        onStatusChange: handleStatusChange,
      },
      {
        ...DEFAULT_BACKGROUND_CONFIG,
        ...config,
      }
    );

    try {
      await recorderRef.current.start();
    } catch (error) {
      recorderRef.current = null;
      throw error;
    }
  }, [handleCapture, handleError, handleStatusChange]);

  // Stop recording
  const stopRecording = useCallback(async (): Promise<void> => {
    if (!recorderRef.current) {
      return;
    }

    await recorderRef.current.stop();
    recorderRef.current = null;

    setState(prev => ({
      ...prev,
      isRecording: false,
      hasWakeLock: false,
    }));
  }, []);

  // Clear captured data
  const clearCaptures = useCallback(() => {
    setState(prev => ({
      ...prev,
      recentCaptures: [],
      captureCount: 0,
    }));
  }, []);

  // Get recent features for training
  const getRecentFeatures = useCallback((): number[][] => {
    return state.recentCaptures.map(c => c.features.raw);
  }, [state.recentCaptures]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recorderRef.current) {
        recorderRef.current.stop();
        recorderRef.current = null;
      }
    };
  }, []);

  return {
    ...state,
    startRecording,
    stopRecording,
    clearCaptures,
    getRecentFeatures,
    supportDetails,
  };
}
