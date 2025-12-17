/**
 * Storage module public API
 */

// Database
export { getDatabase, closeDatabase, deleteDatabase, isDatabaseAvailable } from './database';

// Room operations
export {
  createRoom,
  getRoom,
  getAllRooms,
  getRoomsByCreated,
  updateRoom,
  deleteRoom,
  getRoomCount,
  roomNameExists,
} from './RoomStore';

// Sample operations
export {
  createSample,
  getSample,
  getSamplesForRoom,
  getAllSamples,
  getSampleCountForRoom,
  getSampleCountsByRoom,
  deleteSample,
  deleteSamplesForRoom,
  getTotalSampleCount,
  getTrainingData,
  canTrain,
} from './SampleStore';

// Model operations
export {
  saveModel,
  getModel,
  hasModel,
  deleteModel,
  getModelMetadata,
  getModelRoomLabels,
  getModelNormalizer,
  modelNeedsRetraining,
} from './ModelStore';

// Types
export type {
  Room,
  Sample,
  SampleMetadata,
  StoredModel,
  FeatureNormalizer,
  ModelMetadata,
  TrainingProgress,
} from './types';

export { DB_NAME, DB_VERSION, STORES } from './types';
