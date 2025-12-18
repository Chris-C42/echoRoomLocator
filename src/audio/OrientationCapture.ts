/**
 * OrientationCapture - Device orientation capture for mobile devices
 *
 * Uses the DeviceOrientation API to capture phone orientation during audio recording.
 * Supports:
 * - iOS 13+ (requires explicit permission request)
 * - Android Chrome (requires HTTPS)
 * - Absolute orientation (compass heading) when available
 */

export interface DeviceOrientation {
  alpha: number | null;  // 0-360 (compass heading, may be null without magnetometer)
  beta: number | null;   // -180 to 180 (front-to-back tilt)
  gamma: number | null;  // -90 to 90 (left-to-right tilt)
  timestamp: number;
  absolute: boolean;     // Whether alpha is absolute (compass) or relative
}

// Permission state
let permissionGranted: boolean | null = null;

// Check if the DeviceOrientation API is available
export function hasOrientationSupport(): boolean {
  return 'DeviceOrientationEvent' in window;
}

// Check if iOS permission request is needed
export function needsPermissionRequest(): boolean {
  return typeof (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission === 'function';
}

// Check if we're on HTTPS (required for orientation API)
export function isSecureContext(): boolean {
  return window.isSecureContext ||
         window.location.protocol === 'https:' ||
         window.location.hostname === 'localhost' ||
         window.location.hostname === '127.0.0.1';
}

/**
 * Request orientation permission (required on iOS 13+)
 * Must be called from a user gesture (click/tap handler)
 * Returns true if permission granted, false otherwise
 */
export async function requestOrientationPermission(): Promise<boolean> {
  if (!hasOrientationSupport()) {
    console.warn('[Orientation] DeviceOrientation API not supported');
    return false;
  }

  if (!isSecureContext()) {
    console.warn('[Orientation] Requires HTTPS');
    return false;
  }

  // Check if iOS permission request is available
  if (needsPermissionRequest()) {
    try {
      const DeviceOrientationEventTyped = DeviceOrientationEvent as unknown as {
        requestPermission: () => Promise<'granted' | 'denied' | 'default'>;
      };
      const permission = await DeviceOrientationEventTyped.requestPermission();
      permissionGranted = permission === 'granted';
      console.log('[Orientation] iOS permission:', permission);
      return permissionGranted;
    } catch (error) {
      console.error('[Orientation] Permission request failed:', error);
      permissionGranted = false;
      return false;
    }
  }

  // No permission needed on other platforms
  permissionGranted = true;
  return true;
}

// Current orientation state
let currentOrientation: DeviceOrientation = {
  alpha: null,
  beta: null,
  gamma: null,
  timestamp: 0,
  absolute: false
};

let isListening = false;
let orientationHandler: ((event: DeviceOrientationEvent) => void) | null = null;
let absoluteHandler: ((event: DeviceOrientationEvent) => void) | null = null;
let usingAbsoluteOrientation = false;
let onOrientationChange: ((orientation: DeviceOrientation) => void) | null = null;

/**
 * Start listening for orientation events
 * Tries to use deviceorientationabsolute first (gives compass heading on Android)
 * Falls back to deviceorientation if absolute is not available
 *
 * @param callback - Optional callback for orientation updates
 * @returns Cleanup function to stop listening
 */
export function startOrientationListener(
  callback?: (orientation: DeviceOrientation) => void
): () => void {
  if (!hasOrientationSupport()) {
    console.warn('[Orientation] DeviceOrientation API not supported');
    return () => {};
  }

  if (!isSecureContext()) {
    console.warn('[Orientation] Requires HTTPS');
    return () => {};
  }

  // On iOS, check if permission was granted
  if (needsPermissionRequest() && !permissionGranted) {
    console.warn('[Orientation] iOS permission not granted. Call requestOrientationPermission() first.');
    return () => {};
  }

  if (isListening) {
    // Already listening, update the callback
    onOrientationChange = callback || null;
    console.log('[Orientation] Updated callback, already listening');
    return () => stopOrientationListener();
  }

  // Store the callback
  onOrientationChange = callback || null;

  // Create handler that updates current orientation and calls callback
  const handleOrientationEvent = (event: DeviceOrientationEvent, isAbsolute: boolean) => {
    const newOrientation: DeviceOrientation = {
      alpha: event.alpha,
      beta: event.beta,
      gamma: event.gamma,
      timestamp: Date.now(),
      absolute: isAbsolute || (event as DeviceOrientationEvent & { absolute?: boolean }).absolute === true
    };

    // Only update if we have actual data
    if (newOrientation.alpha !== null || newOrientation.beta !== null || newOrientation.gamma !== null) {
      currentOrientation = newOrientation;

      if (onOrientationChange) {
        onOrientationChange(currentOrientation);
      }
    }
  };

  // Try deviceorientationabsolute first (provides compass heading on Android)
  absoluteHandler = (event: DeviceOrientationEvent) => {
    handleOrientationEvent(event, true);
  };

  orientationHandler = (event: DeviceOrientationEvent) => {
    // Only use regular deviceorientation if we're not getting absolute events
    if (!usingAbsoluteOrientation) {
      handleOrientationEvent(event, false);
    }
  };

  // Listen for deviceorientationabsolute (Chrome/Android)
  if ('ondeviceorientationabsolute' in window) {
    window.addEventListener('deviceorientationabsolute', absoluteHandler as EventListener);
    usingAbsoluteOrientation = true;
    console.log('[Orientation] Using deviceorientationabsolute (compass heading)');
  }

  // Also listen for regular deviceorientation as fallback
  window.addEventListener('deviceorientation', orientationHandler);
  isListening = true;

  console.log('[Orientation] Started listening for orientation events');
  return () => stopOrientationListener();
}

/**
 * Stop listening for orientation events
 */
export function stopOrientationListener(): void {
  if (absoluteHandler) {
    window.removeEventListener('deviceorientationabsolute', absoluteHandler as EventListener);
    absoluteHandler = null;
  }
  if (orientationHandler) {
    window.removeEventListener('deviceorientation', orientationHandler);
    orientationHandler = null;
  }
  isListening = false;
  usingAbsoluteOrientation = false;
  onOrientationChange = null;
  console.log('[Orientation] Stopped listening for orientation events');
}

/**
 * Get the current orientation snapshot
 * If listener is active, returns current value immediately
 * Otherwise returns null values (listener should be started via startOrientationListener)
 */
export function getCurrentOrientation(): DeviceOrientation {
  // Return the current value if we have one
  if (currentOrientation.timestamp > 0) {
    return { ...currentOrientation };
  }

  // Return empty orientation if no data yet
  return {
    alpha: null,
    beta: null,
    gamma: null,
    timestamp: Date.now(),
    absolute: false
  };
}

/**
 * Check if the orientation listener is currently active
 */
export function isOrientationListening(): boolean {
  return isListening;
}

/**
 * Check if we have valid orientation data
 */
export function hasOrientationData(): boolean {
  return currentOrientation.timestamp > 0 &&
    (currentOrientation.alpha !== null ||
     currentOrientation.beta !== null ||
     currentOrientation.gamma !== null);
}

/**
 * Get the permission state
 */
export function getOrientationPermissionState(): 'granted' | 'denied' | 'unknown' | 'not-needed' {
  if (!needsPermissionRequest()) {
    return 'not-needed';
  }
  if (permissionGranted === true) {
    return 'granted';
  }
  if (permissionGranted === false) {
    return 'denied';
  }
  return 'unknown';
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
  needsPermission: boolean;
  permissionState: 'granted' | 'denied' | 'unknown' | 'not-needed';
  isAbsolute: boolean;
} {
  return {
    supported: hasOrientationSupport(),
    secure: isSecureContext(),
    listening: isListening,
    hasData: currentOrientation.timestamp > 0 && hasValidOrientation(currentOrientation),
    needsPermission: needsPermissionRequest(),
    permissionState: getOrientationPermissionState(),
    isAbsolute: currentOrientation.absolute
  };
}
