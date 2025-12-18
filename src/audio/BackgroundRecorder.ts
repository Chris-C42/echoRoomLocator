/**
 * BackgroundRecorder - Continuous ambient audio recording service
 *
 * Features:
 * - Periodic ambient audio capture
 * - Wake lock to prevent device sleep
 * - Configurable capture intervals
 * - Battery-aware operation
 * - Feature extraction on each capture
 */

import { AmbientCaptureResult, AmbientFeatureVector } from './types';
import { capturePassive } from './AudioCapture';
import { extractAmbientFeatures } from './AmbientFeatureExtractor';

export interface BackgroundRecorderConfig {
  intervalSeconds: number;    // Time between captures (e.g., 30)
  durationSeconds: number;    // Duration of each capture (e.g., 3)
  includeOrientation: boolean;
  maxSamplesPerSession: number;  // Limit samples to prevent memory issues
  batteryThreshold: number;   // Stop if battery below this (0-1)
}

export const DEFAULT_BACKGROUND_CONFIG: BackgroundRecorderConfig = {
  intervalSeconds: 30,
  durationSeconds: 3,
  includeOrientation: true,
  maxSamplesPerSession: 100,
  batteryThreshold: 0.15,  // 15%
};

export interface BackgroundRecorderCallbacks {
  onCapture: (
    features: AmbientFeatureVector,
    captureResult: AmbientCaptureResult,
    captureIndex: number
  ) => void;
  onError: (error: Error) => void;
  onStatusChange?: (status: BackgroundRecorderStatus) => void;
}

export interface BackgroundRecorderStatus {
  isRunning: boolean;
  captureCount: number;
  lastCaptureTime: number | null;
  hasWakeLock: boolean;
  batteryLevel: number | null;
  error: string | null;
}

export class BackgroundRecorder {
  private config: BackgroundRecorderConfig;
  private callbacks: BackgroundRecorderCallbacks;

  private isRunning: boolean = false;
  private wakeLock: WakeLockSentinel | null = null;
  private captureCount: number = 0;
  private lastCaptureTime: number | null = null;
  private loopTimeoutId: number | null = null;
  private error: string | null = null;

  constructor(
    callbacks: BackgroundRecorderCallbacks,
    config?: Partial<BackgroundRecorderConfig>
  ) {
    this.callbacks = callbacks;
    this.config = {
      ...DEFAULT_BACKGROUND_CONFIG,
      ...config,
    };
  }

  /**
   * Start continuous background recording
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('[BackgroundRecorder] Already running');
      return;
    }

    console.log('[BackgroundRecorder] Starting...');

    // Check battery level
    const batteryOk = await this.checkBattery();
    if (!batteryOk) {
      const error = new Error('Battery too low for continuous recording');
      this.callbacks.onError(error);
      return;
    }

    // Request wake lock
    await this.requestWakeLock();

    this.isRunning = true;
    this.captureCount = 0;
    this.error = null;

    this.reportStatus();

    // Start capture loop
    this.runCaptureLoop();
  }

  /**
   * Stop background recording
   */
  async stop(): Promise<void> {
    console.log('[BackgroundRecorder] Stopping...');

    this.isRunning = false;

    // Clear pending timeout
    if (this.loopTimeoutId !== null) {
      clearTimeout(this.loopTimeoutId);
      this.loopTimeoutId = null;
    }

    // Release wake lock
    await this.releaseWakeLock();

    this.reportStatus();
  }

  /**
   * Get current status
   */
  getStatus(): BackgroundRecorderStatus {
    return {
      isRunning: this.isRunning,
      captureCount: this.captureCount,
      lastCaptureTime: this.lastCaptureTime,
      hasWakeLock: this.wakeLock !== null,
      batteryLevel: null,  // Will be updated async
      error: this.error,
    };
  }

  /**
   * Update configuration while running
   */
  updateConfig(config: Partial<BackgroundRecorderConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * Main capture loop
   */
  private async runCaptureLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        // Check if we've hit max samples
        if (this.captureCount >= this.config.maxSamplesPerSession) {
          console.log('[BackgroundRecorder] Max samples reached, stopping');
          await this.stop();
          break;
        }

        // Check battery
        const batteryOk = await this.checkBattery();
        if (!batteryOk) {
          console.log('[BackgroundRecorder] Battery low, stopping');
          this.error = 'Battery too low';
          await this.stop();
          break;
        }

        // Capture audio
        const captureResult = await capturePassive(
          this.config.durationSeconds,
          this.config.includeOrientation
        );

        // Extract features
        const features = extractAmbientFeatures(
          captureResult.audio,
          captureResult.sampleRate
        );

        this.captureCount++;
        this.lastCaptureTime = Date.now();

        // Notify callback
        this.callbacks.onCapture(features, captureResult, this.captureCount);
        this.reportStatus();

        // Wait for next interval
        if (this.isRunning) {
          await this.sleep(this.config.intervalSeconds * 1000);
        }
      } catch (error) {
        console.error('[BackgroundRecorder] Capture error:', error);
        this.error = error instanceof Error ? error.message : 'Unknown error';
        this.callbacks.onError(error instanceof Error ? error : new Error(String(error)));

        // Continue running but back off on error
        if (this.isRunning) {
          await this.sleep(5000);
        }
      }
    }
  }

  /**
   * Request screen wake lock to prevent device sleep
   */
  private async requestWakeLock(): Promise<void> {
    if (!('wakeLock' in navigator)) {
      console.warn('[BackgroundRecorder] Wake Lock API not supported');
      return;
    }

    try {
      this.wakeLock = await navigator.wakeLock.request('screen');

      this.wakeLock.addEventListener('release', () => {
        console.log('[BackgroundRecorder] Wake lock released');
        this.wakeLock = null;
        this.reportStatus();
      });

      console.log('[BackgroundRecorder] Wake lock acquired');
    } catch (error) {
      console.warn('[BackgroundRecorder] Failed to acquire wake lock:', error);
    }
  }

  /**
   * Release wake lock
   */
  private async releaseWakeLock(): Promise<void> {
    if (this.wakeLock) {
      try {
        await this.wakeLock.release();
        this.wakeLock = null;
        console.log('[BackgroundRecorder] Wake lock released');
      } catch (error) {
        console.warn('[BackgroundRecorder] Failed to release wake lock:', error);
      }
    }
  }

  /**
   * Check if battery level is acceptable
   */
  private async checkBattery(): Promise<boolean> {
    if (!('getBattery' in navigator)) {
      // Battery API not supported, assume OK
      return true;
    }

    try {
      const battery = await (navigator as Navigator & {
        getBattery(): Promise<{ level: number; charging: boolean }>
      }).getBattery();

      // If charging, always allow
      if (battery.charging) {
        return true;
      }

      // Check threshold
      return battery.level >= this.config.batteryThreshold;
    } catch (error) {
      console.warn('[BackgroundRecorder] Failed to check battery:', error);
      return true;  // Assume OK if can't check
    }
  }

  /**
   * Report status to callback
   */
  private reportStatus(): void {
    if (this.callbacks.onStatusChange) {
      this.callbacks.onStatusChange(this.getStatus());
    }
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.loopTimeoutId = window.setTimeout(resolve, ms);
    });
  }
}

/**
 * Check if continuous recording is supported
 */
export function isContinuousRecordingSupported(): {
  supported: boolean;
  hasWakeLock: boolean;
  hasBatteryApi: boolean;
  reason?: string;
} {
  const hasWakeLock = 'wakeLock' in navigator;
  const hasBatteryApi = 'getBattery' in navigator;

  return {
    supported: true,  // Basic support with or without wake lock
    hasWakeLock,
    hasBatteryApi,
    reason: hasWakeLock
      ? undefined
      : 'Wake Lock API not supported. Device may sleep during recording.',
  };
}
