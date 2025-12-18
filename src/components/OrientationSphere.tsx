/**
 * OrientationSphere - 3D sphere visualization of device orientation
 *
 * Shows:
 * - A 3D sphere with coordinate axes (X=red, Y=green, Z=blue)
 * - Real-time phone orientation displayed as a tilted reference frame
 * - Green points on the sphere surface for previous sample orientations
 */

import { useRef, useEffect, useCallback } from 'react';
import { DeviceOrientation } from '../audio/OrientationCapture';

interface OctantCoverage {
  octantsCovered: number;
  octantCounts: {
    upperN: number; upperE: number; upperS: number; upperW: number;
    lowerN: number; lowerE: number; lowerS: number; lowerW: number;
  };
}

interface Props {
  /** Current device orientation (real-time) */
  currentOrientation: DeviceOrientation | null;
  /** Previous sample orientations (normalized: [alpha/360, beta_shifted, gamma_shifted]) */
  sampleOrientations: Array<[number, number, number]>;
  /** Size of the canvas in pixels */
  size?: number;
  /** Whether to show the coordinate axes labels */
  showLabels?: boolean;
  /** Optional octant coverage stats */
  octantCoverage?: OctantCoverage;
}

// 3D point type
interface Point3D {
  x: number;
  y: number;
  z: number;
}

// Project 3D point to 2D with perspective
function project(point: Point3D, size: number, fov: number = 300): { x: number; y: number; scale: number } {
  const scale = fov / (fov + point.z);
  return {
    x: point.x * scale + size / 2,
    y: point.y * scale + size / 2,
    scale,
  };
}

// Rotate point around X axis
function rotateX(point: Point3D, angle: number): Point3D {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: point.x,
    y: point.y * cos - point.z * sin,
    z: point.y * sin + point.z * cos,
  };
}

// Rotate point around Y axis
function rotateY(point: Point3D, angle: number): Point3D {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: point.x * cos + point.z * sin,
    y: point.y,
    z: -point.x * sin + point.z * cos,
  };
}

// Rotate point around Z axis
function rotateZ(point: Point3D, angle: number): Point3D {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
    z: point.z,
  };
}

// Convert device orientation to rotation angles
function orientationToRotation(orientation: DeviceOrientation | null): { alpha: number; beta: number; gamma: number } {
  if (!orientation) {
    return { alpha: 0, beta: 0, gamma: 0 };
  }

  // Convert degrees to radians
  const alpha = ((orientation.alpha ?? 0) * Math.PI) / 180;
  const beta = ((orientation.beta ?? 0) * Math.PI) / 180;
  const gamma = ((orientation.gamma ?? 0) * Math.PI) / 180;

  return { alpha, beta, gamma };
}

/**
 * Convert normalized sample orientation to a point on the sphere surface
 * Uses the phone's up-vector (local Y-axis) transformed by all three Euler angles
 *
 * Device orientation Euler angles:
 * - alpha (yaw): rotation around world Z-axis (compass heading)
 * - beta (pitch): rotation around device X-axis (tilt forward/back)
 * - gamma (roll): rotation around device Y-axis (tilt left/right)
 *
 * We compute where the phone's up-vector (0, 1, 0) points in world space
 */
function sampleOrientationToPoint(normalized: [number, number, number], radius: number): Point3D {
  // Denormalize: stored as [alpha/360, (beta+180)/360, (gamma+90)/180]
  const alphaDeg = normalized[0] * 360;
  const betaDeg = normalized[1] * 360 - 180;
  const gammaDeg = normalized[2] * 180 - 90;

  // Convert to radians
  const alpha = (alphaDeg * Math.PI) / 180;
  const beta = (betaDeg * Math.PI) / 180;
  const gamma = (gammaDeg * Math.PI) / 180;

  // Start with device's local up-vector (Y-axis)
  let upVector: Point3D = { x: 0, y: 1, z: 0 };

  // Apply device orientation rotations (same order as axes visualization)
  // Order: Z (roll/gamma), X (pitch/beta), Y (yaw/alpha)
  upVector = rotateZ(upVector, gamma);
  upVector = rotateX(upVector, beta);
  upVector = rotateY(upVector, alpha);

  // Scale to sphere surface
  return {
    x: upVector.x * radius,
    y: upVector.y * radius,
    z: upVector.z * radius,
  };
}

export default function OrientationSphere({
  currentOrientation,
  sampleOrientations,
  size = 150,
  showLabels = true,
  octantCoverage,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, size, size);

    const radius = size * 0.35;

    // Get device rotation
    const rotation = orientationToRotation(currentOrientation);

    // Base rotation for better view (tilt the view slightly)
    const baseRotX = -0.3;
    const baseRotY = 0.2;

    // Apply device rotation to the view
    const viewRotX = baseRotX + rotation.beta;
    const viewRotY = baseRotY - rotation.alpha;

    // Draw sphere wireframe
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 0.5;

    // Draw latitude circles
    for (let lat = -60; lat <= 60; lat += 30) {
      const latRad = (lat * Math.PI) / 180;
      const r = radius * Math.cos(latRad);
      const y = radius * Math.sin(latRad);

      ctx.beginPath();
      for (let lon = 0; lon <= 360; lon += 10) {
        const lonRad = (lon * Math.PI) / 180;
        let point: Point3D = {
          x: r * Math.sin(lonRad),
          y: y,
          z: r * Math.cos(lonRad),
        };

        // Apply view rotation
        point = rotateX(point, viewRotX);
        point = rotateY(point, viewRotY);

        const projected = project(point, size);

        if (lon === 0) {
          ctx.moveTo(projected.x, projected.y);
        } else {
          ctx.lineTo(projected.x, projected.y);
        }
      }
      ctx.stroke();
    }

    // Draw longitude circles
    for (let lon = 0; lon < 180; lon += 30) {
      const lonRad = (lon * Math.PI) / 180;

      ctx.beginPath();
      for (let lat = 0; lat <= 360; lat += 10) {
        const latRad = (lat * Math.PI) / 180;
        let point: Point3D = {
          x: radius * Math.cos(latRad) * Math.sin(lonRad),
          y: radius * Math.sin(latRad),
          z: radius * Math.cos(latRad) * Math.cos(lonRad),
        };

        // Apply view rotation
        point = rotateX(point, viewRotX);
        point = rotateY(point, viewRotY);

        const projected = project(point, size);

        if (lat === 0) {
          ctx.moveTo(projected.x, projected.y);
        } else {
          ctx.lineTo(projected.x, projected.y);
        }
      }
      ctx.stroke();
    }

    // Draw coordinate axes (device orientation frame)
    const axisLength = radius * 0.8;
    const axes: Array<{ dir: Point3D; color: string; label: string }> = [
      { dir: { x: axisLength, y: 0, z: 0 }, color: '#ef4444', label: 'X' },  // Red - Right
      { dir: { x: 0, y: -axisLength, z: 0 }, color: '#22c55e', label: 'Y' }, // Green - Up (inverted for display)
      { dir: { x: 0, y: 0, z: axisLength }, color: '#3b82f6', label: 'Z' },  // Blue - Forward
    ];

    // Apply device orientation to axes
    for (const axis of axes) {
      let point = { ...axis.dir };

      // Apply device orientation (in reverse order: Z, X, Y)
      point = rotateZ(point, rotation.gamma);
      point = rotateX(point, rotation.beta);
      point = rotateY(point, rotation.alpha);

      // Apply view rotation
      point = rotateX(point, viewRotX);
      point = rotateY(point, viewRotY);

      const origin: Point3D = { x: 0, y: 0, z: 0 };
      let rotatedOrigin = rotateX(origin, viewRotX);
      rotatedOrigin = rotateY(rotatedOrigin, viewRotY);

      const projectedOrigin = project(rotatedOrigin, size);
      const projectedPoint = project(point, size);

      // Draw axis line
      ctx.strokeStyle = axis.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(projectedOrigin.x, projectedOrigin.y);
      ctx.lineTo(projectedPoint.x, projectedPoint.y);
      ctx.stroke();

      // Draw arrowhead
      const arrowSize = 6;
      const angle = Math.atan2(
        projectedPoint.y - projectedOrigin.y,
        projectedPoint.x - projectedOrigin.x
      );
      ctx.beginPath();
      ctx.moveTo(projectedPoint.x, projectedPoint.y);
      ctx.lineTo(
        projectedPoint.x - arrowSize * Math.cos(angle - Math.PI / 6),
        projectedPoint.y - arrowSize * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        projectedPoint.x - arrowSize * Math.cos(angle + Math.PI / 6),
        projectedPoint.y - arrowSize * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fillStyle = axis.color;
      ctx.fill();

      // Draw label
      if (showLabels) {
        ctx.fillStyle = axis.color;
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText(
          axis.label,
          projectedPoint.x + 5,
          projectedPoint.y + 3
        );
      }
    }

    // Draw sample orientation points (green dots)
    for (const sampleOrientation of sampleOrientations) {
      let point = sampleOrientationToPoint(sampleOrientation, radius * 1.05);

      // Apply view rotation
      point = rotateX(point, viewRotX);
      point = rotateY(point, viewRotY);

      // Only draw points on the visible side (z > -50)
      if (point.z > -50) {
        const projected = project(point, size);
        const pointRadius = 4 * projected.scale;

        // Draw glowing point
        const gradient = ctx.createRadialGradient(
          projected.x, projected.y, 0,
          projected.x, projected.y, pointRadius * 2
        );
        gradient.addColorStop(0, 'rgba(34, 197, 94, 0.9)');
        gradient.addColorStop(0.5, 'rgba(34, 197, 94, 0.4)');
        gradient.addColorStop(1, 'rgba(34, 197, 94, 0)');

        ctx.beginPath();
        ctx.arc(projected.x, projected.y, pointRadius * 2, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();

        // Draw solid center
        ctx.beginPath();
        ctx.arc(projected.x, projected.y, pointRadius, 0, Math.PI * 2);
        ctx.fillStyle = '#22c55e';
        ctx.fill();
      }
    }

    // Draw current phone up-vector position (yellow pulsing marker)
    // This shows where the next capture will be placed on the sphere
    if (currentOrientation && currentOrientation.timestamp > 0) {
      // Compute the phone's up-vector using all three Euler angles
      let upVector: Point3D = { x: 0, y: 1, z: 0 };
      upVector = rotateZ(upVector, rotation.gamma);
      upVector = rotateX(upVector, rotation.beta);
      upVector = rotateY(upVector, rotation.alpha);

      // Scale to sphere surface
      let currentPoint: Point3D = {
        x: upVector.x * radius * 1.05,
        y: upVector.y * radius * 1.05,
        z: upVector.z * radius * 1.05,
      };

      // Apply view rotation
      currentPoint = rotateX(currentPoint, viewRotX);
      currentPoint = rotateY(currentPoint, viewRotY);

      // Draw if visible
      if (currentPoint.z > -50) {
        const projected = project(currentPoint, size);
        const pointRadius = 6 * projected.scale;

        // Draw pulsing outer ring (yellow/amber)
        const pulse = (Math.sin(Date.now() / 200) + 1) / 2; // 0-1 pulsing
        const outerRadius = pointRadius * (1.5 + pulse * 0.5);

        ctx.beginPath();
        ctx.arc(projected.x, projected.y, outerRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(251, 191, 36, ${0.5 + pulse * 0.3})`;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw solid center (amber)
        ctx.beginPath();
        ctx.arc(projected.x, projected.y, pointRadius, 0, Math.PI * 2);
        ctx.fillStyle = '#fbbf24';
        ctx.fill();

        // Draw crosshair
        ctx.strokeStyle = '#1f2937';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(projected.x - pointRadius * 0.6, projected.y);
        ctx.lineTo(projected.x + pointRadius * 0.6, projected.y);
        ctx.moveTo(projected.x, projected.y - pointRadius * 0.6);
        ctx.lineTo(projected.x, projected.y + pointRadius * 0.6);
        ctx.stroke();
      }
    }

    // Draw cardinal directions on sphere equator
    const cardinalDirs = [
      { angle: 0, label: 'N', color: '#f59e0b' },
      { angle: 90, label: 'E', color: '#9ca3af' },
      { angle: 180, label: 'S', color: '#9ca3af' },
      { angle: 270, label: 'W', color: '#9ca3af' },
    ];

    for (const cardinal of cardinalDirs) {
      const rad = (cardinal.angle * Math.PI) / 180;
      let point: Point3D = {
        x: (radius + 15) * Math.sin(rad),
        y: 0,
        z: (radius + 15) * Math.cos(rad),
      };

      // Apply view rotation
      point = rotateX(point, viewRotX);
      point = rotateY(point, viewRotY);

      // Only show if visible
      if (point.z > -100) {
        const projected = project(point, size);
        ctx.fillStyle = cardinal.color;
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(cardinal.label, projected.x, projected.y);
      }
    }

    // Request next frame if we have real-time orientation
    if (currentOrientation) {
      animationRef.current = requestAnimationFrame(draw);
    }
  }, [currentOrientation, sampleOrientations, size, showLabels]);

  // Start/stop animation based on currentOrientation
  useEffect(() => {
    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [draw]);

  // Get orientation info for display
  const orientationInfo = currentOrientation
    ? {
        alpha: Math.round(currentOrientation.alpha ?? 0),
        beta: Math.round(currentOrientation.beta ?? 0),
        gamma: Math.round(currentOrientation.gamma ?? 0),
        absolute: currentOrientation.absolute,
      }
    : null;

  return (
    <div className="flex flex-col items-center gap-2">
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        className="rounded-lg"
        style={{ width: size, height: size }}
      />

      {/* Orientation values */}
      {orientationInfo && (
        <div className="text-xs text-gray-400 text-center">
          <div className="flex gap-3 justify-center">
            <span className="text-amber-400">
              {orientationInfo.alpha}°
            </span>
            <span className="text-gray-500">|</span>
            <span>
              {orientationInfo.beta}° / {orientationInfo.gamma}°
            </span>
          </div>
          {orientationInfo.absolute && (
            <div className="text-green-400 text-[10px]">Compass</div>
          )}
        </div>
      )}

      {!currentOrientation && (
        <div className="text-xs text-gray-500 text-center">
          No orientation data
        </div>
      )}

      {/* Sample count */}
      {sampleOrientations.length > 0 && (
        <div className="text-xs text-green-400">
          {sampleOrientations.length} sample{sampleOrientations.length !== 1 ? 's' : ''} shown
        </div>
      )}

      {/* Octant coverage display */}
      {octantCoverage && (
        <div className="mt-2 text-xs">
          <div className="text-gray-400 text-center mb-1">
            Octant Coverage: {octantCoverage.octantsCovered}/8
          </div>
          <div className="flex flex-col gap-1">
            {/* Upper hemisphere */}
            <div className="flex justify-center gap-1">
              {(['upperN', 'upperE', 'upperS', 'upperW'] as const).map((octant) => (
                <div
                  key={octant}
                  className={`w-6 h-6 rounded text-[10px] flex items-center justify-center ${
                    octantCoverage.octantCounts[octant] > 0
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-700 text-gray-400'
                  }`}
                  title={`Upper ${octant.slice(-1)}: ${octantCoverage.octantCounts[octant]} samples`}
                >
                  {octant.slice(-1)}↑
                </div>
              ))}
            </div>
            {/* Lower hemisphere */}
            <div className="flex justify-center gap-1">
              {(['lowerN', 'lowerE', 'lowerS', 'lowerW'] as const).map((octant) => (
                <div
                  key={octant}
                  className={`w-6 h-6 rounded text-[10px] flex items-center justify-center ${
                    octantCoverage.octantCounts[octant] > 0
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-700 text-gray-400'
                  }`}
                  title={`Lower ${octant.slice(-1)}: ${octantCoverage.octantCounts[octant]} samples`}
                >
                  {octant.slice(-1)}↓
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
