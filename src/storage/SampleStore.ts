/**
 * Sample storage operations
 */

import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from './database';
import { Sample, SampleFeatures, SampleMetadata, STORES } from './types';

/**
 * Create a new sample for a room
 */
export async function createSample(
  roomId: string,
  features: SampleFeatures,
  metadata: SampleMetadata
): Promise<Sample> {
  const db = await getDatabase();

  const sample: Sample = {
    id: uuidv4(),
    roomId,
    features,
    metadata,
    capturedAt: Date.now(),
  };

  await db.add(STORES.SAMPLES, sample);
  return sample;
}

/**
 * Get a sample by ID
 */
export async function getSample(id: string): Promise<Sample | undefined> {
  const db = await getDatabase();
  return db.get(STORES.SAMPLES, id);
}

/**
 * Get all samples for a specific room
 */
export async function getSamplesForRoom(roomId: string): Promise<Sample[]> {
  const db = await getDatabase();
  return db.getAllFromIndex(STORES.SAMPLES, 'by-room', roomId);
}

/**
 * Get all samples
 */
export async function getAllSamples(): Promise<Sample[]> {
  const db = await getDatabase();
  return db.getAll(STORES.SAMPLES);
}

/**
 * Get sample count for a specific room
 */
export async function getSampleCountForRoom(roomId: string): Promise<number> {
  const db = await getDatabase();
  const samples = await db.getAllKeysFromIndex(STORES.SAMPLES, 'by-room', roomId);
  return samples.length;
}

/**
 * Get sample counts for all rooms
 */
export async function getSampleCountsByRoom(): Promise<Map<string, number>> {
  const db = await getDatabase();
  const samples = await db.getAll(STORES.SAMPLES);

  const counts = new Map<string, number>();
  for (const sample of samples) {
    const current = counts.get(sample.roomId) || 0;
    counts.set(sample.roomId, current + 1);
  }

  return counts;
}

/**
 * Delete a sample
 */
export async function deleteSample(id: string): Promise<boolean> {
  const db = await getDatabase();
  await db.delete(STORES.SAMPLES, id);
  return true;
}

/**
 * Delete all samples for a room
 */
export async function deleteSamplesForRoom(roomId: string): Promise<number> {
  const db = await getDatabase();

  const tx = db.transaction(STORES.SAMPLES, 'readwrite');
  const index = tx.store.index('by-room');
  let cursor = await index.openCursor(IDBKeyRange.only(roomId));

  let count = 0;
  while (cursor) {
    await cursor.delete();
    count++;
    cursor = await cursor.continue();
  }

  await tx.done;
  return count;
}

/**
 * Get total sample count
 */
export async function getTotalSampleCount(): Promise<number> {
  const db = await getDatabase();
  return db.count(STORES.SAMPLES);
}

/**
 * Get training data: features and labels for all samples
 * Returns samples grouped by room with their feature vectors
 *
 * For multi-modal support, extracts raw features from structured SampleFeatures
 */
export async function getTrainingData(): Promise<{
  features: number[][];
  labels: string[];
  roomIds: string[];
}> {
  const db = await getDatabase();
  const samples = await db.getAll(STORES.SAMPLES);

  const features: number[][] = [];
  const labels: string[] = [];
  const roomIdSet = new Set<string>();

  for (const sample of samples) {
    // Extract raw features from structured SampleFeatures
    // Prefer raw, then chirpFeatures, then ambientFeatures
    let featureVector: number[] | undefined;

    if (sample.features.raw) {
      featureVector = sample.features.raw;
    } else if (sample.features.chirpFeatures) {
      featureVector = sample.features.chirpFeatures;
    } else if (sample.features.ambientFeatures) {
      featureVector = sample.features.ambientFeatures;
    }

    if (featureVector && featureVector.length > 0) {
      features.push(featureVector);
      labels.push(sample.roomId);
      roomIdSet.add(sample.roomId);
    }
  }

  return {
    features,
    labels,
    roomIds: Array.from(roomIdSet),
  };
}

/**
 * Check if we have enough samples for training
 * Requires at least 2 rooms with minSamplesPerRoom samples each
 */
export async function canTrain(minSamplesPerRoom = 5): Promise<{
  canTrain: boolean;
  roomCount: number;
  readyRooms: number;
  totalSamples: number;
  message: string;
}> {
  const counts = await getSampleCountsByRoom();
  const roomCount = counts.size;

  let readyRooms = 0;
  let totalSamples = 0;

  for (const count of counts.values()) {
    totalSamples += count;
    if (count >= minSamplesPerRoom) {
      readyRooms++;
    }
  }

  const canTrainResult = readyRooms >= 2;

  let message: string;
  if (roomCount < 2) {
    message = `Need at least 2 rooms (have ${roomCount})`;
  } else if (readyRooms < 2) {
    message = `Need at least 2 rooms with ${minSamplesPerRoom}+ samples (have ${readyRooms})`;
  } else {
    message = `Ready to train with ${readyRooms} rooms and ${totalSamples} samples`;
  }

  return {
    canTrain: canTrainResult,
    roomCount,
    readyRooms,
    totalSamples,
    message,
  };
}
