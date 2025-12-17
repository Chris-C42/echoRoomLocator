/**
 * IndexedDB database setup and initialization
 */

import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { Room, Sample, StoredModel, DB_NAME, DB_VERSION, STORES } from './types';

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
    upgrade(db, oldVersion, newVersion, _transaction) {
      console.log(`Upgrading database from v${oldVersion} to v${newVersion}`);

      // Create rooms store
      if (!db.objectStoreNames.contains(STORES.ROOMS)) {
        const roomStore = db.createObjectStore(STORES.ROOMS, { keyPath: 'id' });
        roomStore.createIndex('by-name', 'name');
        roomStore.createIndex('by-created', 'createdAt');
      }

      // Create samples store
      if (!db.objectStoreNames.contains(STORES.SAMPLES)) {
        const sampleStore = db.createObjectStore(STORES.SAMPLES, { keyPath: 'id' });
        sampleStore.createIndex('by-room', 'roomId');
        sampleStore.createIndex('by-captured', 'capturedAt');
      }

      // Create model store
      if (!db.objectStoreNames.contains(STORES.MODEL)) {
        db.createObjectStore(STORES.MODEL, { keyPath: 'id' });
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
