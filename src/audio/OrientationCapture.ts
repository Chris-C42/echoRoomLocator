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
 * @deprecated Use normalizeOrientationQuaternion instead for gimbal-lock-free representation
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
 * Quaternion representation [w, x, y, z]
 * Unit quaternion for 3D rotation, no gimbal lock
 */
export type Quaternion = [number, number, number, number];

/**
 * Convert device orientation Euler angles to quaternion
 *
 * Device orientation uses ZXY intrinsic rotation order:
 * - alpha (Z-axis): compass heading 0-360°
 * - beta (X-axis): front-to-back tilt -180° to 180°
 * - gamma (Y-axis): left-to-right tilt -90° to 90°
 *
 * The quaternion is computed as: q = q_z * q_x * q_y
 * This matches the device orientation convention and avoids gimbal lock
 *
 * Returns [w, x, y, z] unit quaternion
 */
export function eulerToQuaternion(
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number
): Quaternion {
  // Convert to radians and half-angles
  const alpha = (alphaDeg * Math.PI) / 180;
  const beta = (betaDeg * Math.PI) / 180;
  const gamma = (gammaDeg * Math.PI) / 180;

  const ha = alpha / 2; // half alpha (Z rotation)
  const hb = beta / 2;  // half beta (X rotation)
  const hg = gamma / 2; // half gamma (Y rotation)

  const ca = Math.cos(ha);
  const sa = Math.sin(ha);
  const cb = Math.cos(hb);
  const sb = Math.sin(hb);
  const cg = Math.cos(hg);
  const sg = Math.sin(hg);

  // Quaternion multiplication for ZXY order: q = q_z * q_x * q_y
  // q_z = (cos(α/2), 0, 0, sin(α/2))
  // q_x = (cos(β/2), sin(β/2), 0, 0)
  // q_y = (cos(γ/2), 0, sin(γ/2), 0)
  //
  // First: q_zx = q_z * q_x
  // Then: q = q_zx * q_y
  const w = ca * cb * cg - sa * sb * sg;
  const x = ca * sb * cg - sa * cb * sg;
  const y = ca * cb * sg + sa * sb * cg;
  const z = sa * cb * cg + ca * sb * sg;

  return [w, x, y, z];
}

/**
 * Convert quaternion back to Euler angles (for debugging/display)
 * Returns [alpha, beta, gamma] in degrees
 */
export function quaternionToEuler(q: Quaternion): [number, number, number] {
  const [w, x, y, z] = q;

  // Roll (gamma) - Y axis
  const sinr_cosp = 2 * (w * y + z * x);
  const cosr_cosp = 1 - 2 * (y * y + x * x);
  const gamma = Math.atan2(sinr_cosp, cosr_cosp) * 180 / Math.PI;

  // Pitch (beta) - X axis
  const sinp = 2 * (w * x - z * y);
  let beta: number;
  if (Math.abs(sinp) >= 1) {
    beta = Math.sign(sinp) * 90; // Use 90 degrees if out of range
  } else {
    beta = Math.asin(sinp) * 180 / Math.PI;
  }

  // Yaw (alpha) - Z axis
  const siny_cosp = 2 * (w * z + x * y);
  const cosy_cosp = 1 - 2 * (x * x + z * z);
  let alpha = Math.atan2(siny_cosp, cosy_cosp) * 180 / Math.PI;
  if (alpha < 0) alpha += 360; // Normalize to 0-360

  return [alpha, beta, gamma];
}

/**
 * Normalize orientation to quaternion format for ML and storage
 * Returns [w, x, y, z] unit quaternion
 *
 * This is the preferred normalization as it:
 * - Avoids gimbal lock at extreme pitch angles
 * - Provides consistent representation for all orientations
 * - Is more stable for interpolation and comparison
 */
export function normalizeOrientationQuaternion(
  orientation: DeviceOrientation
): Quaternion {
  const alpha = orientation.alpha ?? 0;
  const beta = orientation.beta ?? 0;
  const gamma = orientation.gamma ?? 0;

  return eulerToQuaternion(alpha, beta, gamma);
}

/**
 * Rotate a 3D vector by a quaternion
 * Used to compute where the phone's up-vector points in world space
 */
export function rotateVectorByQuaternion(
  v: [number, number, number],
  q: Quaternion
): [number, number, number] {
  const [w, qx, qy, qz] = q;
  const [vx, vy, vz] = v;

  // Quaternion rotation: v' = q * v * q^(-1)
  // For unit quaternion: q^(-1) = [w, -x, -y, -z]
  // Optimized formula:
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);

  return [
    vx + w * tx + (qy * tz - qz * ty),
    vy + w * ty + (qz * tx - qx * tz),
    vz + w * tz + (qx * ty - qy * tx),
  ];
}

/**
 * Get the phone's up-vector in world coordinates from a quaternion
 * This is the direction the phone's screen is facing
 */
export function getUpVectorFromQuaternion(q: Quaternion): [number, number, number] {
  // Phone's local up-vector is (0, 1, 0)
  // Rotate it by the orientation quaternion
  return rotateVectorByQuaternion([0, 1, 0], q);
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
