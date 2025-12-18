/**
 * Model storage operations
 */

import { getDatabase } from './database';
import { StoredModel, FeatureNormalizer, ModelMetadata, STORES } from './types';

const MODEL_ID = 'current' as const;

/**
 * Save a trained model (single-mode, for backward compatibility)
 */
export async function saveModel(
  topology: object,
  weights: ArrayBuffer,
  roomLabels: string[],
  normalizer: FeatureNormalizer,
  metadata: ModelMetadata
): Promise<StoredModel> {
  const db = await getDatabase();

  const storedModel: StoredModel = {
    id: MODEL_ID,
    modelType: 'single',
    topology,
    weights,
    roomLabels,
    normalizer,
    metadata,
    createdAt: Date.now(),
  };

  await db.put(STORES.MODEL, storedModel);
  return storedModel;
}

/**
 * Get the current stored model
 */
export async function getModel(): Promise<StoredModel | undefined> {
  const db = await getDatabase();
  return db.get(STORES.MODEL, MODEL_ID);
}

/**
 * Check if a model exists
 */
export async function hasModel(): Promise<boolean> {
  const model = await getModel();
  return model !== undefined;
}

/**
 * Delete the stored model
 */
export async function deleteModel(): Promise<boolean> {
  const db = await getDatabase();

  const existing = await db.get(STORES.MODEL, MODEL_ID);
  if (!existing) {
    return false;
  }

  await db.delete(STORES.MODEL, MODEL_ID);
  return true;
}

/**
 * Get model metadata without loading the full weights
 */
export async function getModelMetadata(): Promise<{
  roomLabels: string[];
  normalizer?: FeatureNormalizer;
  metadata: ModelMetadata;
  createdAt: number;
  modelType: 'single' | 'multimodal';
} | undefined> {
  const model = await getModel();
  if (!model) {
    return undefined;
  }

  return {
    roomLabels: model.roomLabels,
    normalizer: model.normalizer,
    metadata: model.metadata,
    createdAt: model.createdAt,
    modelType: model.modelType,
  };
}

/**
 * Get room labels from the model (for inference)
 */
export async function getModelRoomLabels(): Promise<string[] | undefined> {
  const model = await getModel();
  return model?.roomLabels;
}

/**
 * Get the feature normalizer from the model
 */
export async function getModelNormalizer(): Promise<FeatureNormalizer | undefined> {
  const model = await getModel();
  return model?.normalizer;
}

/**
 * Check if the model needs retraining
 * (e.g., if rooms have been added/removed since training)
 */
export async function modelNeedsRetraining(currentRoomIds: string[]): Promise<boolean> {
  const model = await getModel();
  if (!model) {
    return true; // No model = needs training
  }

  const modelRoomSet = new Set(model.roomLabels);
  const currentRoomSet = new Set(currentRoomIds);

  // Check if sets are different
  if (modelRoomSet.size !== currentRoomSet.size) {
    return true;
  }

  for (const roomId of currentRoomIds) {
    if (!modelRoomSet.has(roomId)) {
      return true;
    }
  }

  return false;
}
