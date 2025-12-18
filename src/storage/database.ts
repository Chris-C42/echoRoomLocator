/**
 * IndexedDB database setup and initialization
 *
 * Database Versions:
 * - v1: Original schema with flat feature arrays
 * - v2: Multi-modal samples with structured features + orientation
 */

import { openDB, DBSchema, IDBPDatabase } from 'idb';
import {
  Room,
  Sample,
  SampleFeatures,
  SampleMetadata,
  StoredModel,
  LegacySample,
  DB_NAME,
  DB_VERSION,
  STORES
} from './types';

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
