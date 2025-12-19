/**
 * IndexedDB database setup and initialization
 *
 * Database Versions:
 * - v1: Original schema with flat feature arrays
 * - v2: Multi-modal samples with structured features + Euler orientation
 * - v3: Quaternion orientation (4 values) instead of Euler (3 values)
 */

import { openDB, DBSchema, IDBPDatabase } from 'idb';
import {
  Room,
  Sample,
  SampleFeatures,
  SampleMetadata,
  StoredModel,
  LegacySample,
  OrientationEuler,
  OrientationQuaternion,
  DB_NAME,
  DB_VERSION,
  STORES
} from './types';

/**
 * Convert normalized Euler angles to quaternion
 * Used for migrating v2 samples to v3 format
 *
 * Input format: [alpha/360, (beta+180)/360, (gamma+90)/180]
 * Output: [w, x, y, z] unit quaternion
 */
function eulerToQuaternionMigration(euler: OrientationEuler): OrientationQuaternion {
  // Denormalize
  const alphaDeg = euler[0] * 360;
  const betaDeg = euler[1] * 360 - 180;
  const gammaDeg = euler[2] * 180 - 90;

  // Convert to radians and half-angles
  const alpha = (alphaDeg * Math.PI) / 180;
  const beta = (betaDeg * Math.PI) / 180;
  const gamma = (gammaDeg * Math.PI) / 180;

  const ha = alpha / 2;
  const hb = beta / 2;
  const hg = gamma / 2;

  const ca = Math.cos(ha);
  const sa = Math.sin(ha);
  const cb = Math.cos(hb);
  const sb = Math.sin(hb);
  const cg = Math.cos(hg);
  const sg = Math.sin(hg);

  // ZXY rotation order quaternion
  const w = ca * cb * cg - sa * sb * sg;
  const x = ca * sb * cg - sa * cb * sg;
  const y = ca * cb * sg + sa * sb * cg;
  const z = sa * cb * cg + ca * sb * sg;

  return [w, x, y, z];
}

interface EchoRoomDB extends DBSchema {
  [STORES.ROOMS]: {
    key: string;
    value: Room;
    indexes: {
      'by-name': string;
      'by-created': number;
    };
  };
  [STORES.SAMPLES]: {
    key: string;
    value: Sample;
    indexes: {
      'by-room': string;
      'by-captured': number;
    };
  };
  [STORES.MODEL]: {
    key: 'current';
    value: StoredModel;
  };
}

let dbInstance: IDBPDatabase<EchoRoomDB> | null = null;

/**
 * Get or create the database instance
 */
export async function getDatabase(): Promise<IDBPDatabase<EchoRoomDB>> {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = await openDB<EchoRoomDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, newVersion, transaction) {
      console.log(`Upgrading database from v${oldVersion} to v${newVersion}`);

      // Create rooms store (v1+)
      if (!db.objectStoreNames.contains(STORES.ROOMS)) {
        const roomStore = db.createObjectStore(STORES.ROOMS, { keyPath: 'id' });
        roomStore.createIndex('by-name', 'name');
        roomStore.createIndex('by-created', 'createdAt');
      }

      // Create samples store (v1+)
      if (!db.objectStoreNames.contains(STORES.SAMPLES)) {
        const sampleStore = db.createObjectStore(STORES.SAMPLES, { keyPath: 'id' });
        sampleStore.createIndex('by-room', 'roomId');
        sampleStore.createIndex('by-captured', 'capturedAt');
      }

      // Create model store (v1+)
      if (!db.objectStoreNames.contains(STORES.MODEL)) {
        db.createObjectStore(STORES.MODEL, { keyPath: 'id' });
      }

      // Migration: v1 → v2
      // Convert flat feature arrays to structured SampleFeatures
      if (oldVersion < 2 && oldVersion >= 1) {
        console.log('Migrating samples from v1 to v2 format...');

        const sampleStore = transaction.objectStore(STORES.SAMPLES);
        const modelStore = transaction.objectStore(STORES.MODEL);

        // Migrate samples
        sampleStore.openCursor().then(function migrateSamples(cursor): Promise<void> | void {
          if (!cursor) {
            console.log('Sample migration complete');
            return;
          }

          const oldSample = cursor.value as unknown as LegacySample;

          // Check if already migrated (has structured features)
          if (typeof oldSample.features === 'object' && 'mode' in oldSample.features) {
            return cursor.continue().then(migrateSamples);
          }

          // Convert flat array to structured features
          const newFeatures: SampleFeatures = {
            mode: 'chirp',
            chirpFeatures: oldSample.features as number[],
            raw: oldSample.features as number[],  // Keep for backward compat
          };

          // Convert metadata
          const newMetadata: SampleMetadata = {
            captureMode: 'chirp',
            chirpMode: oldSample.metadata?.chirpMode || 'audible',
            duration: oldSample.metadata?.duration || 0,
            sampleRate: oldSample.metadata?.sampleRate || 48000,
            deviceInfo: oldSample.metadata?.deviceInfo,
            hasOrientation: false,
          };

          const newSample: Sample = {
            id: oldSample.id,
            roomId: oldSample.roomId,
            features: newFeatures,
            metadata: newMetadata,
            capturedAt: oldSample.capturedAt,
          };

          cursor.update(newSample);
          return cursor.continue().then(migrateSamples);
        });

        // Migrate model to add modelType field
        modelStore.get('current').then((model) => {
          if (model && !('modelType' in model)) {
            const updatedModel: StoredModel = {
              ...(model as StoredModel),
              modelType: 'single',
            };
            modelStore.put(updatedModel);
            console.log('Model migrated to v2 format');
          }
        });
      }

      // Migration: v2 → v3
      // Convert Euler orientation [3] to Quaternion [4]
      if (oldVersion < 3 && oldVersion >= 2) {
        console.log('Migrating samples from v2 to v3 format (Euler → Quaternion)...');

        const sampleStore = transaction.objectStore(STORES.SAMPLES);

        sampleStore.openCursor().then(function migrateOrientations(cursor): Promise<void> | void {
          if (!cursor) {
            console.log('Orientation migration complete');
            return;
          }

          const sample = cursor.value as Sample;

          // Check if sample has Euler orientation (3 values) that needs conversion
          if (sample.features.orientation && sample.features.orientation.length === 3) {
            const eulerOrientation = sample.features.orientation as unknown as OrientationEuler;

            // Convert to quaternion
            const quaternionOrientation = eulerToQuaternionMigration(eulerOrientation);

            // Update features
            const updatedFeatures: SampleFeatures = {
              ...sample.features,
              orientation: quaternionOrientation,
              orientationEuler: eulerOrientation,  // Keep original for reference
            };

            const updatedSample: Sample = {
              ...sample,
              features: updatedFeatures,
            };

            cursor.update(updatedSample);
            console.log(`Migrated sample ${sample.id} orientation to quaternion`);
          }

          return cursor.continue().then(migrateOrientations);
        });

        // Clear the model since feature format changed (4 values instead of 3)
        const modelStore = transaction.objectStore(STORES.MODEL);
        modelStore.get('current').then((model) => {
          if (model) {
            // Delete existing model since orientation feature length changed
            modelStore.delete('current');
            console.log('Cleared existing model due to orientation format change - retraining required');
          }
        });
      }
    },
    blocked() {
      console.warn('Database upgrade blocked - close other tabs');
    },
    blocking() {
      // Close our connection to allow upgrade in other tab
      dbInstance?.close();
      dbInstance = null;
    },
    terminated() {
      console.error('Database connection terminated unexpectedly');
      dbInstance = null;
    },
  });

  return dbInstance;
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * Delete the entire database (use with caution)
 */
export async function deleteDatabase(): Promise<void> {
  closeDatabase();
  await indexedDB.deleteDatabase(DB_NAME);
}

/**
 * Check if the database is available and working
 */
export async function isDatabaseAvailable(): Promise<boolean> {
  try {
    const db = await getDatabase();
    return db !== null;
  } catch (error) {
    console.error('Database not available:', error);
    return false;
  }
}
