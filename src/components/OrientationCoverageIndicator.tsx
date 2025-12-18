/**
 * OrientationCoverageIndicator - Visual indicator of orientation diversity
 *
 * Shows a compass-style display of which directions have samples,
 * helping users ensure they capture from multiple orientations.
 */

import { OrientationStats } from '../utils';

interface Props {
  stats: OrientationStats;
  size?: number;
  showRecommendation?: boolean;
}

export default function OrientationCoverageIndicator({
  stats,
  size = 120,
  showRecommendation = true,
}: Props) {
  const { quadrantCounts, diversityScore, samplesWithOrientation, totalSamples, warnings } = stats;
  const total = samplesWithOrientation || 1;

  // Calculate fill levels for each quadrant (0-1)
  const fills = {
    north: Math.min(quadrantCounts.north / Math.max(total / 4, 1), 1),
    east: Math.min(quadrantCounts.east / Math.max(total / 4, 1), 1),
    south: Math.min(quadrantCounts.south / Math.max(total / 4, 1), 1),
    west: Math.min(quadrantCounts.west / Math.max(total / 4, 1), 1),
  };

  // Color based on diversity score
  const getDiversityColor = () => {
    if (diversityScore >= 0.7) return '#22c55e'; // green
    if (diversityScore >= 0.4) return '#eab308'; // yellow
    return '#ef4444'; // red
  };

  // Quadrant color based on fill
  const getQuadrantColor = (fill: number, hasAny: boolean) => {
    if (!hasAny) return '#374151'; // gray-700
    if (fill >= 0.8) return '#22c55e'; // green
    if (fill >= 0.5) return '#84cc16'; // lime
    if (fill >= 0.25) return '#eab308'; // yellow
    return '#f97316'; // orange
  };

  // Find lowest quadrant for recommendation
  const lowestQuadrant = Object.entries(quadrantCounts)
    .sort((a, b) => a[1] - b[1])[0];

  const directionLabels: Record<string, string> = {
    north: 'N',
    east: 'E',
    south: 'S',
    west: 'W',
  };

  const directionAngles: Record<string, number> = {
    north: -90,
    east: 0,
    south: 90,
    west: 180,
  };

  const center = size / 2;
  const radius = size / 2 - 15;
  const innerRadius = radius * 0.3;

  if (samplesWithOrientation === 0) {
    return (
      <div className="flex flex-col items-center gap-2 text-gray-400">
        <div
          className="flex items-center justify-center rounded-full border-2 border-gray-600"
          style={{ width: size, height: size }}
        >
          <span className="text-xs text-center px-2">
            No orientation data
          </span>
        </div>
        <span className="text-xs">
          Enable orientation to track coverage
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background circle */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="#1f2937"
          stroke="#374151"
          strokeWidth="2"
        />

        {/* Quadrant arcs */}
        {(['north', 'east', 'south', 'west'] as const).map((direction) => {
          const startAngle = directionAngles[direction] - 45;
          const endAngle = directionAngles[direction] + 45;
          const fill = fills[direction];
          const count = quadrantCounts[direction];
          const hasAny = count > 0;

          // Calculate arc path
          const arcRadius = innerRadius + (radius - innerRadius) * fill;
          const startRad = (startAngle * Math.PI) / 180;
          const endRad = (endAngle * Math.PI) / 180;

          const x1 = center + arcRadius * Math.cos(startRad);
          const y1 = center + arcRadius * Math.sin(startRad);
          const x2 = center + arcRadius * Math.cos(endRad);
          const y2 = center + arcRadius * Math.sin(endRad);

          const innerX1 = center + innerRadius * Math.cos(startRad);
          const innerY1 = center + innerRadius * Math.sin(startRad);
          const innerX2 = center + innerRadius * Math.cos(endRad);
          const innerY2 = center + innerRadius * Math.sin(endRad);

          const pathD = `
            M ${innerX1} ${innerY1}
            L ${x1} ${y1}
            A ${arcRadius} ${arcRadius} 0 0 1 ${x2} ${y2}
            L ${innerX2} ${innerY2}
            A ${innerRadius} ${innerRadius} 0 0 0 ${innerX1} ${innerY1}
          `;

          return (
            <g key={direction}>
              <path
                d={pathD}
                fill={getQuadrantColor(fill, hasAny)}
                opacity={hasAny ? 0.8 : 0.3}
              />
              {/* Direction label */}
              <text
                x={center + (radius + 8) * Math.cos((directionAngles[direction] * Math.PI) / 180)}
                y={center + (radius + 8) * Math.sin((directionAngles[direction] * Math.PI) / 180)}
                fill="#9ca3af"
                fontSize="10"
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {directionLabels[direction]}
              </text>
              {/* Count in quadrant */}
              {hasAny && (
                <text
                  x={center + ((innerRadius + radius) / 2) * Math.cos((directionAngles[direction] * Math.PI) / 180)}
                  y={center + ((innerRadius + radius) / 2) * Math.sin((directionAngles[direction] * Math.PI) / 180)}
                  fill="white"
                  fontSize="11"
                  fontWeight="bold"
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {count}
                </text>
              )}
            </g>
          );
        })}

        {/* Center circle with diversity score */}
        <circle
          cx={center}
          cy={center}
          r={innerRadius - 2}
          fill={getDiversityColor()}
          opacity="0.9"
        />
        <text
          x={center}
          y={center}
          fill="white"
          fontSize="12"
          fontWeight="bold"
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {Math.round(diversityScore * 100)}%
        </text>
      </svg>

      {/* Stats text */}
      <div className="text-center text-xs text-gray-400">
        <div>
          {samplesWithOrientation}/{totalSamples} with orientation
        </div>
      </div>

      {/* Recommendation */}
      {showRecommendation && warnings.length > 0 && (
        <div className="text-xs text-yellow-400 text-center max-w-[200px]">
          {lowestQuadrant[1] === 0 ? (
            <span>Try facing {lowestQuadrant[0]}</span>
          ) : (
            <span>{warnings[0]}</span>
          )}
        </div>
      )}
    </div>
  );
}
