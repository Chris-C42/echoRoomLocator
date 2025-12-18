/**
 * useAudioEngine - React hook for audio capture and feature extraction
 *
 * Provides:
 * - Microphone permission handling
 * - Chirp playback and audio capture
 * - Ambient audio capture (no chirp)
 * - Feature extraction from captured audio
 * - Device orientation capture
 * - Real-time audio level monitoring
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  ChirpMode,
  CaptureMode,
  AudioCaptureResult,
  AmbientCaptureResult,
  FeatureVector,
  AmbientFeatureVector,
  captureRoomResponse,
  capturePassive,
  hasMicrophonePermission,
  requestMicrophonePermission,
  closeAudioContext,
  createLevelMeter,
} from '../audio';
import { extractImpulseResponse } from '../audio/ImpulseResponseExtractor';
import { extractFeatures } from '../audio/FeatureExtractor';
import { extractAmbientFeatures } from '../audio/AmbientFeatureExtractor';
import {
  hasOrientationSupport,
  isSecureContext,
  getOrientationStatus,
  normalizeOrientation,
  DeviceOrientation,
} from '../audio/OrientationCapture';

export type CaptureState = 'idle' | 'requesting' | 'capturing' | 'processing' | 'complete' | 'error';

export interface AudioEngineState {
  captureState: CaptureState;
  hasPermission: boolean | null;
  hasOrientationSupport: boolean;
  error: string | null;
  audioLevel: number;
  lastCapture: AudioCaptureResult | null;
  lastAmbientCapture: AmbientCaptureResult | null;
  lastFeatures: FeatureVector | null;
  lastAmbientFeatures: AmbientFeatureVector | null;
  lastOrientation: DeviceOrientation | null;
}

export interface CaptureResult {
  features: number[];
  orientation?: [number, number, number];
  mode: CaptureMode;
}

export interface UseAudioEngineReturn {
  state: AudioEngineState;
  capture: (mode: ChirpMode, includeOrientation?: boolean) => Promise<FeatureVector | null>;
  captureAmbient: (durationSeconds?: number, includeOrientation?: boolean) => Promise<AmbientFeatureVector | null>;
  getCaptureResult: () => CaptureResult | null;
  requestPermission: () => Promise<boolean>;
  startLevelMonitor: () => Promise<() => void>;
  reset: () => void;
}

export function useAudioEngine(): UseAudioEngineReturn {
  const [state, setState] = useState<AudioEngineState>({
    captureState: 'idle',
    hasPermission: null,
    hasOrientationSupport: hasOrientationSupport() && isSecureContext(),
    error: null,
    audioLevel: 0,
    lastCapture: null,
    lastAmbientCapture: null,
    lastFeatures: null,
    lastAmbientFeatures: null,
    lastOrientation: null,
  });

  const levelMonitorCleanup = useRef<(() => void) | null>(null);
  const lastCaptureMode = useRef<CaptureMode | null>(null);

  // Check permission on mount
  useEffect(() => {
    hasMicrophonePermission().then((hasPermission) => {
      setState((prev) => ({ ...prev, hasPermission }));
    });

    // Check orientation support
    const orientationStatus = getOrientationStatus();
    setState((prev) => ({
      ...prev,
      hasOrientationSupport: orientationStatus.supported && orientationStatus.secure,
    }));

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
   * Capture audio with chirp and extract features
   */
  const capture = useCallback(async (
    mode: ChirpMode,
    includeOrientation: boolean = true
  ): Promise<FeatureVector | null> => {
    console.log('[AudioEngine] Starting chirp capture with mode:', mode);

    setState((prev) => ({
      ...prev,
      captureState: 'capturing',
      error: null,
      lastCapture: null,
      lastFeatures: null,
      lastOrientation: null,
    }));

    try {
      // Capture room response (now includes orientation)
      console.log('[AudioEngine] Calling captureRoomResponse...');
      const captureResult = await captureRoomResponse(mode, undefined, 0.8, includeOrientation);
      console.log('[AudioEngine] Capture complete, processing...');

      setState((prev) => ({
        ...prev,
        captureState: 'processing',
        lastCapture: captureResult,
        lastOrientation: captureResult.orientation || null,
      }));

      // Extract impulse response
      console.log('[AudioEngine] Extracting impulse response...');
      const ir = extractImpulseResponse(captureResult);

      // Extract features
      console.log('[AudioEngine] Extracting features...');
      const features = extractFeatures(ir);
      console.log('[AudioEngine] Features extracted:', features.raw.length, 'values');

      lastCaptureMode.current = 'chirp';

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
   * Capture ambient audio (no chirp) and extract features
   */
  const captureAmbient = useCallback(async (
    durationSeconds: number = 3,
    includeOrientation: boolean = true
  ): Promise<AmbientFeatureVector | null> => {
    console.log('[AudioEngine] Starting ambient capture, duration:', durationSeconds);

    setState((prev) => ({
      ...prev,
      captureState: 'capturing',
      error: null,
      lastAmbientCapture: null,
      lastAmbientFeatures: null,
      lastOrientation: null,
    }));

    try {
      // Capture ambient audio
      console.log('[AudioEngine] Calling capturePassive...');
      const captureResult = await capturePassive(durationSeconds, includeOrientation);
      console.log('[AudioEngine] Ambient capture complete, processing...');

      setState((prev) => ({
        ...prev,
        captureState: 'processing',
        lastAmbientCapture: captureResult,
        lastOrientation: captureResult.orientation || null,
      }));

      // Extract ambient features
      console.log('[AudioEngine] Extracting ambient features...');
      const features = extractAmbientFeatures(captureResult.audio, captureResult.sampleRate);
      console.log('[AudioEngine] Ambient features extracted:', features.raw.length, 'values');

      lastCaptureMode.current = 'ambient-manual';

      setState((prev) => ({
        ...prev,
        captureState: 'complete',
        lastAmbientFeatures: features,
      }));

      return features;
    } catch (error) {
      console.error('[AudioEngine] Ambient capture error:', error);
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
   * Get the last capture result with normalized orientation
   * Useful for storage
   */
  const getCaptureResult = useCallback((): CaptureResult | null => {
    const mode = lastCaptureMode.current;
    if (!mode) return null;

    let features: number[] | null = null;
    let orientation: [number, number, number] | undefined;

    if (mode === 'chirp' && state.lastFeatures) {
      features = state.lastFeatures.raw;
    } else if (mode.startsWith('ambient') && state.lastAmbientFeatures) {
      features = state.lastAmbientFeatures.raw;
    }

    if (state.lastOrientation) {
      orientation = normalizeOrientation(state.lastOrientation);
    }

    if (!features) return null;

    return {
      features,
      orientation,
      mode,
    };
  }, [state.lastFeatures, state.lastAmbientFeatures, state.lastOrientation]);

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
    lastCaptureMode.current = null;
    setState((prev) => ({
      ...prev,
      captureState: 'idle',
      error: null,
      lastCapture: null,
      lastAmbientCapture: null,
      lastFeatures: null,
      lastAmbientFeatures: null,
      lastOrientation: null,
    }));
  }, []);

  return {
    state,
    capture,
    captureAmbient,
    getCaptureResult,
    requestPermission,
    startLevelMonitor,
    reset,
  };
}
