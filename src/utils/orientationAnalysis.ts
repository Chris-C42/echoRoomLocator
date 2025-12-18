/**
 * Orientation Analysis Utilities
 *
 * Analyzes orientation diversity across samples to help ensure
 * training data doesn't have orientation bias.
 */

export interface OrientationStats {
  // Number of samples with orientation data
  samplesWithOrientation: number;
  totalSamples: number;

  // Coverage metrics (0-1, where 1 = full coverage)
  yawCoverage: number;      // Coverage around horizontal plane (alpha)
  pitchCoverage: number;    // Coverage of tilt angles (beta)
  rollCoverage: number;     // Coverage of roll angles (gamma)
  overallCoverage: number;  // Combined coverage score

  // Quadrant distribution (how many samples in each direction)
  quadrantCounts: {
    north: number;  // alpha 315-45°
    east: number;   // alpha 45-135°
    south: number;  // alpha 135-225°
    west: number;   // alpha 225-315°
  };

  // Diversity score (0-1, higher = more diverse)
  diversityScore: number;

  // Warnings
  warnings: string[];
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

  if (samplesWithOrientation === 0) {
    return {
      samplesWithOrientation: 0,
      totalSamples,
      yawCoverage: 0,
      pitchCoverage: 0,
      rollCoverage: 0,
      overallCoverage: 0,
      quadrantCounts: { north: 0, east: 0, south: 0, west: 0 },
      diversityScore: 0,
      warnings: ['No orientation data available'],
    };
  }

  // Extract normalized values (stored as 0-1 range)
  const alphas = validOrientations.map((o) => o[0] * 360); // yaw 0-360
  const betas = validOrientations.map((o) => o[1] * 360 - 180); // pitch -180 to 180
  const gammas = validOrientations.map((o) => o[2] * 180 - 90); // roll -90 to 90

  // Compute quadrant distribution (based on yaw/alpha)
  const quadrantCounts = { north: 0, east: 0, south: 0, west: 0 };
  for (const alpha of alphas) {
    if (alpha >= 315 || alpha < 45) quadrantCounts.north++;
    else if (alpha >= 45 && alpha < 135) quadrantCounts.east++;
    else if (alpha >= 135 && alpha < 225) quadrantCounts.south++;
    else quadrantCounts.west++;
  }

  // Compute yaw coverage (how much of the 360° is covered)
  const yawCoverage = computeAngularCoverage(alphas, 360, 4); // 4 bins of 90°

  // Compute pitch coverage (how much of the -180 to 180 range is covered)
  // Most relevant range is -90 to 90 (phone facing up to facing down)
  const relevantBetas = betas.map((b) => Math.max(-90, Math.min(90, b)));
  const pitchCoverage = computeLinearCoverage(relevantBetas, -90, 90, 3); // 3 bins

  // Compute roll coverage (how much of the -90 to 90 range is covered)
  const rollCoverage = computeLinearCoverage(gammas, -90, 90, 3); // 3 bins

  // Overall coverage is weighted average (yaw most important for acoustic variation)
  const overallCoverage = yawCoverage * 0.6 + pitchCoverage * 0.25 + rollCoverage * 0.15;

  // Compute diversity score (entropy-based)
  const diversityScore = computeDiversityScore(quadrantCounts, samplesWithOrientation);

  // Generate warnings
  const warnings: string[] = [];

  if (samplesWithOrientation < totalSamples * 0.5) {
    warnings.push(`Only ${samplesWithOrientation}/${totalSamples} samples have orientation data`);
  }

  if (yawCoverage < 0.5) {
    warnings.push('Low yaw coverage - try rotating phone to face different directions');
  }

  if (diversityScore < 0.5) {
    const dominant = Object.entries(quadrantCounts)
      .sort((a, b) => b[1] - a[1])[0];
    warnings.push(`Most samples facing ${dominant[0]} (${dominant[1]}/${samplesWithOrientation})`);
  }

  // Check for single-orientation bias
  const maxQuadrant = Math.max(...Object.values(quadrantCounts));
  if (maxQuadrant > samplesWithOrientation * 0.7) {
    warnings.push('Strong orientation bias detected - samples mostly from one direction');
  }

  return {
    samplesWithOrientation,
    totalSamples,
    yawCoverage,
    pitchCoverage,
    rollCoverage,
    overallCoverage,
    quadrantCounts,
    diversityScore,
    warnings,
  };
}

/**
 * Compute angular coverage (for circular values like yaw)
 * Returns 0-1 where 1 means all bins have at least one sample
 */
function computeAngularCoverage(angles: number[], fullRange: number, numBins: number): number {
  const binSize = fullRange / numBins;
  const bins = new Array(numBins).fill(0);

  for (const angle of angles) {
    const normalizedAngle = ((angle % fullRange) + fullRange) % fullRange;
    const bin = Math.floor(normalizedAngle / binSize) % numBins;
    bins[bin]++;
  }

  const filledBins = bins.filter((count) => count > 0).length;
  return filledBins / numBins;
}

/**
 * Compute linear coverage (for non-circular values like pitch/roll)
 * Returns 0-1 where 1 means all bins have at least one sample
 */
function computeLinearCoverage(
  values: number[],
  minVal: number,
  maxVal: number,
  numBins: number
): number {
  const range = maxVal - minVal;
  const binSize = range / numBins;
  const bins = new Array(numBins).fill(0);

  for (const value of values) {
    const normalizedValue = Math.max(minVal, Math.min(maxVal, value));
    const bin = Math.min(
      numBins - 1,
      Math.floor((normalizedValue - minVal) / binSize)
    );
    bins[bin]++;
  }

  const filledBins = bins.filter((count) => count > 0).length;
  return filledBins / numBins;
}

/**
 * Compute diversity score based on quadrant distribution
 * Uses normalized entropy (0 = all in one quadrant, 1 = uniform distribution)
 */
function computeDiversityScore(
  quadrantCounts: { north: number; east: number; south: number; west: number },
  totalSamples: number
): number {
  if (totalSamples === 0) return 0;

  const counts = Object.values(quadrantCounts);
  const probabilities = counts.map((c) => c / totalSamples);

  // Compute entropy
  let entropy = 0;
  for (const p of probabilities) {
    if (p > 0) {
      entropy -= p * Math.log2(p);
    }
  }

  // Normalize by max entropy (log2(4) = 2 for 4 quadrants)
  const maxEntropy = Math.log2(4);
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
 * Returns the quadrant with fewest samples
 */
export function getRecommendedOrientation(
  stats: OrientationStats
): { direction: string; description: string } {
  const { quadrantCounts } = stats;

  const entries = Object.entries(quadrantCounts) as [string, number][];
  const sorted = entries.sort((a, b) => a[1] - b[1]);
  const lowestQuadrant = sorted[0][0];

  const descriptions: Record<string, string> = {
    north: 'Face the phone towards 12 o\'clock',
    east: 'Face the phone towards 3 o\'clock (right)',
    south: 'Face the phone towards 6 o\'clock (behind you)',
    west: 'Face the phone towards 9 o\'clock (left)',
  };

  return {
    direction: lowestQuadrant,
    description: descriptions[lowestQuadrant] || 'Rotate phone to a new direction',
  };
}

/**
 * Format orientation stats for display
 */
export function formatOrientationStats(stats: OrientationStats): string {
  if (stats.samplesWithOrientation === 0) {
    return 'No orientation data';
  }

  const diversityPct = Math.round(stats.diversityScore * 100);
  const coveragePct = Math.round(stats.overallCoverage * 100);

  return `Diversity: ${diversityPct}% | Coverage: ${coveragePct}%`;
}
