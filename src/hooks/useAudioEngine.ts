/**
 * useAudioEngine - React hook for audio capture and feature extraction
 *
 * Provides:
 * - Microphone permission handling
 * - Chirp playback and audio capture
 * - Feature extraction from captured audio
 * - Real-time audio level monitoring
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  ChirpMode,
  AudioCaptureResult,
  FeatureVector,
  captureRoomResponse,
  hasMicrophonePermission,
  requestMicrophonePermission,
  closeAudioContext,
  createLevelMeter,
} from '../audio';
import { extractImpulseResponse } from '../audio/ImpulseResponseExtractor';
import { extractFeatures } from '../audio/FeatureExtractor';

export type CaptureState = 'idle' | 'requesting' | 'capturing' | 'processing' | 'complete' | 'error';

export interface AudioEngineState {
  captureState: CaptureState;
  hasPermission: boolean | null;
  error: string | null;
  audioLevel: number;
  lastCapture: AudioCaptureResult | null;
  lastFeatures: FeatureVector | null;
}

export interface UseAudioEngineReturn {
  state: AudioEngineState;
  capture: (mode: ChirpMode) => Promise<FeatureVector | null>;
  requestPermission: () => Promise<boolean>;
  startLevelMonitor: () => Promise<() => void>;
  reset: () => void;
}

export function useAudioEngine(): UseAudioEngineReturn {
  const [state, setState] = useState<AudioEngineState>({
    captureState: 'idle',
    hasPermission: null,
    error: null,
    audioLevel: 0,
    lastCapture: null,
    lastFeatures: null,
  });

  const levelMonitorCleanup = useRef<(() => void) | null>(null);

  // Check permission on mount
  useEffect(() => {
    hasMicrophonePermission().then((hasPermission) => {
      setState((prev) => ({ ...prev, hasPermission }));
    });

    // Cleanup on unmount
    return () => {
      if (levelMonitorCleanup.current) {
        levelMonitorCleanup.current();
      }
      closeAudioContext();
    };
  }, []);

  /**
   * Request microphone permission
   */
  const requestPermission = useCallback(async (): Promise<boolean> => {
    setState((prev) => ({ ...prev, captureState: 'requesting', error: null }));

    try {
      const stream = await requestMicrophonePermission();
      // Stop the stream immediately - we just wanted permission
      stream.getTracks().forEach((track) => track.stop());

      setState((prev) => ({
        ...prev,
        captureState: 'idle',
        hasPermission: true,
      }));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Permission denied';
      setState((prev) => ({
        ...prev,
        captureState: 'error',
        hasPermission: false,
        error: message,
      }));
      return false;
    }
  }, []);

  /**
   * Capture audio and extract features
   */
  const capture = useCallback(async (mode: ChirpMode): Promise<FeatureVector | null> => {
    console.log('[AudioEngine] Starting capture with mode:', mode);

    setState((prev) => ({
      ...prev,
      captureState: 'capturing',
      error: null,
      lastCapture: null,
      lastFeatures: null,
    }));

    try {
      // Capture room response
      console.log('[AudioEngine] Calling captureRoomResponse...');
      const captureResult = await captureRoomResponse(mode);
      console.log('[AudioEngine] Capture complete, processing...');

      setState((prev) => ({
        ...prev,
        captureState: 'processing',
        lastCapture: captureResult,
      }));

      // Extract impulse response
      console.log('[AudioEngine] Extracting impulse response...');
      const ir = extractImpulseResponse(captureResult);

      // Extract features
      console.log('[AudioEngine] Extracting features...');
      const features = extractFeatures(ir);
      console.log('[AudioEngine] Features extracted:', features.raw.length, 'values');

      setState((prev) => ({
        ...prev,
        captureState: 'complete',
        lastFeatures: features,
      }));

      return features;
    } catch (error) {
      console.error('[AudioEngine] Capture error:', error);
      const message = error instanceof Error ? error.message : 'Capture failed';
      setState((prev) => ({
        ...prev,
        captureState: 'error',
        error: message,
      }));
      return null;
    }
  }, []);

  /**
   * Start real-time audio level monitoring
   * Returns a cleanup function
   */
  const startLevelMonitor = useCallback(async (): Promise<() => void> => {
    // Stop existing monitor
    if (levelMonitorCleanup.current) {
      levelMonitorCleanup.current();
    }

    try {
      const stream = await requestMicrophonePermission();

      const cleanup = await createLevelMeter(stream, (level) => {
        setState((prev) => ({ ...prev, audioLevel: level }));
      });

      // Wrap cleanup to also stop the stream
      const fullCleanup = () => {
        cleanup();
        stream.getTracks().forEach((track) => track.stop());
        setState((prev) => ({ ...prev, audioLevel: 0 }));
      };

      levelMonitorCleanup.current = fullCleanup;
      return fullCleanup;
    } catch (error) {
      console.error('Failed to start level monitor:', error);
      return () => {};
    }
  }, []);

  /**
   * Reset state
   */
  const reset = useCallback(() => {
    setState((prev) => ({
      ...prev,
      captureState: 'idle',
      error: null,
      lastCapture: null,
      lastFeatures: null,
    }));
  }, []);

  return {
    state,
    capture,
    requestPermission,
    startLevelMonitor,
    reset,
  };
}
