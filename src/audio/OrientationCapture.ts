/**
 * OrientationCapture - Device orientation capture for Android
 *
 * Uses the DeviceOrientation API to capture phone orientation during audio recording.
 * On Android Chrome, this works without explicit permission but requires HTTPS.
 */

export interface DeviceOrientation {
  alpha: number | null;  // 0-360 (compass heading, may be null without magnetometer)
  beta: number | null;   // -180 to 180 (front-to-back tilt)
  gamma: number | null;  // -90 to 90 (left-to-right tilt)
  timestamp: number;
}

// Check if the DeviceOrientation API is available
export function hasOrientationSupport(): boolean {
  return 'DeviceOrientationEvent' in window;
}

// Check if we're on HTTPS (required for orientation API)
export function isSecureContext(): boolean {
  return window.isSecureContext ||
         window.location.protocol === 'https:' ||
         window.location.hostname === 'localhost' ||
         window.location.hostname === '127.0.0.1';
}

// Current orientation state
let currentOrientation: DeviceOrientation = {
  alpha: null,
  beta: null,
  gamma: null,
  timestamp: 0
};

let isListening = false;
let orientationHandler: ((event: DeviceOrientationEvent) => void) | null = null;

/**
 * Start listening for orientation events
 * Returns a cleanup function to stop listening
 */
export function startOrientationListener(
  callback?: (orientation: DeviceOrientation) => void
): () => void {
  if (!hasOrientationSupport()) {
    console.warn('DeviceOrientation API not supported');
    return () => {};
  }

  if (!isSecureContext()) {
    console.warn('DeviceOrientation requires HTTPS');
    return () => {};
  }

  if (isListening && orientationHandler) {
    // Already listening, just update callback
    return () => stopOrientationListener();
  }

  orientationHandler = (event: DeviceOrientationEvent) => {
    currentOrientation = {
      alpha: event.alpha,
      beta: event.beta,
      gamma: event.gamma,
      timestamp: Date.now()
    };

    if (callback) {
      callback(currentOrientation);
    }
  };

  window.addEventListener('deviceorientation', orientationHandler);
  isListening = true;

  return () => stopOrientationListener();
}

/**
 * Stop listening for orientation events
 */
export function stopOrientationListener(): void {
  if (orientationHandler) {
    window.removeEventListener('deviceorientation', orientationHandler);
    orientationHandler = null;
  }
  isListening = false;
}

/**
 * Get the current orientation snapshot
 * If not listening, starts a temporary listener
 */
export async function getCurrentOrientation(timeoutMs: number = 500): Promise<DeviceOrientation> {
  if (!hasOrientationSupport() || !isSecureContext()) {
    return {
      alpha: null,
      beta: null,
      gamma: null,
      timestamp: Date.now()
    };
  }

  // If already listening, return current value
  if (isListening && currentOrientation.timestamp > 0) {
    return { ...currentOrientation };
  }

  // Start temporary listener
  return new Promise((resolve) => {
    let resolved = false;

    const cleanup = startOrientationListener((orientation) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(orientation);
      }
    });

    // Timeout fallback
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({
          alpha: null,
          beta: null,
          gamma: null,
          timestamp: Date.now()
        });
      }
    }, timeoutMs);
  });
}

/**
 * Normalize orientation values to ML-friendly features
 * Handles null values and converts to normalized range
 *
 * Returns [alpha_normalized, beta_normalized, gamma_normalized]
 * - alpha: 0-1 (from 0-360)
 * - beta: -1 to 1 (from -180 to 180)
 * - gamma: -1 to 1 (from -90 to 90)
 */
export function normalizeOrientation(orientation: DeviceOrientation): [number, number, number] {
  // Default to 0 for null values (phone flat, facing north)
  const alpha = orientation.alpha ?? 0;
  const beta = orientation.beta ?? 0;
  const gamma = orientation.gamma ?? 0;

  return [
    alpha / 360,           // Normalize to 0-1
    beta / 180,            // Normalize to -1 to 1
    gamma / 90             // Normalize to -1 to 1
  ];
}

/**
 * Alternative normalization using sin/cos for circular alpha
 * Better handles the 0/360 wraparound for compass heading
 *
 * Returns [sin(alpha), cos(alpha), beta_normalized, gamma_normalized]
 */
export function normalizeOrientationCircular(
  orientation: DeviceOrientation
): [number, number, number, number] {
  const alpha = orientation.alpha ?? 0;
  const beta = orientation.beta ?? 0;
  const gamma = orientation.gamma ?? 0;

  const alphaRad = (alpha * Math.PI) / 180;

  return [
    Math.sin(alphaRad),    // -1 to 1
    Math.cos(alphaRad),    // -1 to 1
    beta / 180,            // -1 to 1
    gamma / 90             // -1 to 1
  ];
}

/**
 * Check if orientation data is valid (not all nulls)
 */
export function hasValidOrientation(orientation: DeviceOrientation): boolean {
  return orientation.beta !== null || orientation.gamma !== null;
}

/**
 * Get orientation status for UI display
 */
export function getOrientationStatus(): {
  supported: boolean;
  secure: boolean;
  listening: boolean;
  hasData: boolean;
} {
  return {
    supported: hasOrientationSupport(),
    secure: isSecureContext(),
    listening: isListening,
    hasData: currentOrientation.timestamp > 0 && hasValidOrientation(currentOrientation)
  };
}
