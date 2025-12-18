/**
 * Orientation Analysis Utilities
 *
 * Analyzes orientation diversity across samples to help ensure
 * training data doesn't have orientation bias.
 *
 * Uses 8 octants based on the phone's up-vector:
 * - Upper hemisphere (phone tilted up): upperN, upperE, upperS, upperW
 * - Lower hemisphere (phone tilted down): lowerN, lowerE, lowerS, lowerW
 */

// 3D point type for up-vector calculations
interface Point3D {
  x: number;
  y: number;
  z: number;
}

// Octant names
export type OctantName =
  | 'upperN' | 'upperE' | 'upperS' | 'upperW'
  | 'lowerN' | 'lowerE' | 'lowerS' | 'lowerW';

export interface OctantCounts {
  upperN: number;  // Upper hemisphere, facing North
  upperE: number;  // Upper hemisphere, facing East
  upperS: number;  // Upper hemisphere, facing South
  upperW: number;  // Upper hemisphere, facing West
  lowerN: number;  // Lower hemisphere, facing North
  lowerE: number;  // Lower hemisphere, facing East
  lowerS: number;  // Lower hemisphere, facing South
  lowerW: number;  // Lower hemisphere, facing West
}

export interface OrientationStats {
  // Number of samples with orientation data
  samplesWithOrientation: number;
  totalSamples: number;

  // Coverage metrics (0-1, where 1 = full coverage)
  octantCoverage: number;   // How many of the 8 octants have samples (0-1)
  overallCoverage: number;  // Same as octantCoverage for consistency

  // Octant distribution (how many samples in each of 8 octants)
  octantCounts: OctantCounts;

  // Legacy quadrant counts (for backward compatibility)
  quadrantCounts: {
    north: number;
    east: number;
    south: number;
    west: number;
  };

  // Diversity score (0-1, higher = more diverse)
  diversityScore: number;

  // Number of octants covered (0-8)
  octantsCovered: number;

  // Warnings
  warnings: string[];
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

/**
 * Compute the phone's up-vector from normalized orientation values
 * Uses all three Euler angles (alpha, beta, gamma)
 *
 * @param normalized - [alpha/360, (beta+180)/360, (gamma+90)/180]
 * @returns The phone's up-vector in world coordinates
 */
function computeUpVector(normalized: [number, number, number]): Point3D {
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

  // Apply device orientation rotations (ZXY order: gamma/roll, beta/pitch, alpha/yaw)
  upVector = rotateZ(upVector, gamma);
  upVector = rotateX(upVector, beta);
  upVector = rotateY(upVector, alpha);

  return upVector;
}

/**
 * Determine which octant a point belongs to based on its up-vector
 *
 * Octants are divided by:
 * - Hemisphere: Y component (positive = upper, negative = lower)
 * - Quadrant: Based on which horizontal direction the up-vector is tilted toward
 *   - North: Z > 0 and |Z| > |X|
 *   - East: X > 0 and |X| > |Z|
 *   - South: Z < 0 and |Z| > |X|
 *   - West: X < 0 and |X| > |Z|
 */
function getOctant(upVector: Point3D): OctantName {
  const isUpper = upVector.y >= 0;
  const prefix = isUpper ? 'upper' : 'lower';

  // Determine horizontal quadrant based on X and Z components
  const absX = Math.abs(upVector.x);
  const absZ = Math.abs(upVector.z);

  let direction: 'N' | 'E' | 'S' | 'W';
  if (absZ >= absX) {
    // Primarily North or South
    direction = upVector.z >= 0 ? 'N' : 'S';
  } else {
    // Primarily East or West
    direction = upVector.x >= 0 ? 'E' : 'W';
  }

  return `${prefix}${direction}` as OctantName;
}

/**
 * Analyze orientation distribution across samples
 */
export function analyzeOrientationDiversity(
  orientations: Array<[number, number, number] | undefined>
): OrientationStats {
  const validOrientations = orientations.filter(
    (o): o is [number, number, number] => o !== undefined
  );

  const totalSamples = orientations.length;
  const samplesWithOrientation = validOrientations.length;

  // Initialize octant counts
  const octantCounts: OctantCounts = {
    upperN: 0, upperE: 0, upperS: 0, upperW: 0,
    lowerN: 0, lowerE: 0, lowerS: 0, lowerW: 0,
  };

  // Legacy quadrant counts (based on horizontal direction only)
  const quadrantCounts = { north: 0, east: 0, south: 0, west: 0 };

  if (samplesWithOrientation === 0) {
    return {
      samplesWithOrientation: 0,
      totalSamples,
      octantCoverage: 0,
      overallCoverage: 0,
      octantCounts,
      quadrantCounts,
      diversityScore: 0,
      octantsCovered: 0,
      warnings: ['No orientation data available'],
    };
  }

  // Compute octant distribution using up-vector
  for (const orientation of validOrientations) {
    const upVector = computeUpVector(orientation);
    const octant = getOctant(upVector);
    octantCounts[octant]++;

    // Also update legacy quadrant counts (extract direction from octant name)
    const direction = octant.slice(-1).toLowerCase() as 'n' | 'e' | 's' | 'w';
    const directionMap: Record<string, 'north' | 'east' | 'south' | 'west'> = {
      n: 'north', e: 'east', s: 'south', w: 'west'
    };
    quadrantCounts[directionMap[direction]]++;
  }

  // Count how many octants have at least one sample
  const octantsCovered = Object.values(octantCounts).filter((count) => count > 0).length;
  const octantCoverage = octantsCovered / 8;

  // Compute diversity score (entropy-based, now over 8 octants)
  const diversityScore = computeOctantDiversityScore(octantCounts, samplesWithOrientation);

  // Generate warnings
  const warnings: string[] = [];

  if (samplesWithOrientation < totalSamples * 0.5) {
    warnings.push(`Only ${samplesWithOrientation}/${totalSamples} samples have orientation data`);
  }

  if (octantsCovered < 4) {
    warnings.push(`Only ${octantsCovered}/8 octants covered - try different phone orientations`);
  }

  if (diversityScore < 0.5) {
    // Find the dominant octant
    const entries = Object.entries(octantCounts) as [OctantName, number][];
    const sorted = entries.sort((a, b) => b[1] - a[1]);
    const dominant = sorted[0];
    if (dominant[1] > 0) {
      warnings.push(`Most samples in ${formatOctantName(dominant[0])} (${dominant[1]}/${samplesWithOrientation})`);
    }
  }

  // Check for single-octant bias
  const maxOctant = Math.max(...Object.values(octantCounts));
  if (maxOctant > samplesWithOrientation * 0.5) {
    warnings.push('Strong orientation bias detected - samples mostly from one octant');
  }

  return {
    samplesWithOrientation,
    totalSamples,
    octantCoverage,
    overallCoverage: octantCoverage,
    octantCounts,
    quadrantCounts,
    diversityScore,
    octantsCovered,
    warnings,
  };
}

/**
 * Format octant name for display
 */
function formatOctantName(octant: OctantName): string {
  const names: Record<OctantName, string> = {
    upperN: 'Upper North',
    upperE: 'Upper East',
    upperS: 'Upper South',
    upperW: 'Upper West',
    lowerN: 'Lower North',
    lowerE: 'Lower East',
    lowerS: 'Lower South',
    lowerW: 'Lower West',
  };
  return names[octant];
}

/**
 * Compute diversity score based on octant distribution
 * Uses normalized entropy (0 = all in one octant, 1 = uniform distribution)
 */
function computeOctantDiversityScore(
  octantCounts: OctantCounts,
  totalSamples: number
): number {
  if (totalSamples === 0) return 0;

  const counts = Object.values(octantCounts);
  const probabilities = counts.map((c) => c / totalSamples);

  // Compute entropy
  let entropy = 0;
  for (const p of probabilities) {
    if (p > 0) {
      entropy -= p * Math.log2(p);
    }
  }

  // Normalize by max entropy (log2(8) = 3 for 8 octants)
  const maxEntropy = Math.log2(8);
  return entropy / maxEntropy;
}

/**
 * Check if orientation diversity is sufficient for training
 */
export function hasMinimumOrientationDiversity(
  stats: OrientationStats,
  minDiversityScore: number = 0.4,
  minCoverage: number = 0.5
): boolean {
  // If no orientation data, we can't enforce diversity
  if (stats.samplesWithOrientation === 0) {
    return true; // Allow training without orientation
  }

  // If we have orientation data, check diversity
  return stats.diversityScore >= minDiversityScore && stats.overallCoverage >= minCoverage;
}

/**
 * Get recommended next orientation for capturing
 * Returns the octant with fewest samples
 */
export function getRecommendedOrientation(
  stats: OrientationStats
): { direction: string; description: string; octant: OctantName } {
  const { octantCounts } = stats;

  const entries = Object.entries(octantCounts) as [OctantName, number][];
  const sorted = entries.sort((a, b) => a[1] - b[1]);
  const lowestOctant = sorted[0][0];

  const descriptions: Record<OctantName, string> = {
    upperN: 'Tilt phone up, screen facing North (12 o\'clock)',
    upperE: 'Tilt phone up, screen facing East (3 o\'clock)',
    upperS: 'Tilt phone up, screen facing South (6 o\'clock)',
    upperW: 'Tilt phone up, screen facing West (9 o\'clock)',
    lowerN: 'Tilt phone down, screen facing North (12 o\'clock)',
    lowerE: 'Tilt phone down, screen facing East (3 o\'clock)',
    lowerS: 'Tilt phone down, screen facing South (6 o\'clock)',
    lowerW: 'Tilt phone down, screen facing West (9 o\'clock)',
  };

  return {
    direction: formatOctantName(lowestOctant),
    description: descriptions[lowestOctant],
    octant: lowestOctant,
  };
}

/**
 * Format orientation stats for display
 */
export function formatOrientationStats(stats: OrientationStats): string {
  if (stats.samplesWithOrientation === 0) {
    return 'No orientation data';
  }

  return `${stats.octantsCovered}/8 octants covered | Diversity: ${Math.round(stats.diversityScore * 100)}%`;
}

/**
 * Get octant coverage visualization data
 * Returns an array of octant info for UI display
 */
export function getOctantVisualizationData(stats: OrientationStats): Array<{
  name: OctantName;
  displayName: string;
  count: number;
  isCovered: boolean;
  isUpper: boolean;
}> {
  const octants: OctantName[] = [
    'upperN', 'upperE', 'upperS', 'upperW',
    'lowerN', 'lowerE', 'lowerS', 'lowerW',
  ];

  return octants.map((octant) => ({
    name: octant,
    displayName: formatOctantName(octant),
    count: stats.octantCounts[octant],
    isCovered: stats.octantCounts[octant] > 0,
    isUpper: octant.startsWith('upper'),
  }));
}
