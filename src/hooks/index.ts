/**
 * React hooks public API
 */

export { useAudioEngine } from './useAudioEngine';
export type {
  CaptureState,
  AudioEngineState,
  UseAudioEngineReturn,
} from './useAudioEngine';

export { useRooms } from './useRooms';
export type {
  RoomWithSampleCount,
  UseRoomsState,
  UseRoomsReturn,
} from './useRooms';

export { useSamples } from './useSamples';
export type {
  UseSamplesState,
  TrainingReadiness,
  UseSamplesReturn,
} from './useSamples';

// Re-export orientation stats type for convenience
export type { OrientationStats } from '../utils';

export { useRoomClassifier } from './useRoomClassifier';
export type {
  ModelState,
  UseRoomClassifierState,
  UseRoomClassifierReturn,
} from './useRoomClassifier';
