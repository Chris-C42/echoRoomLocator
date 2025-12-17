/**
 * Room storage operations
 */

import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from './database';
import { Room, STORES } from './types';

/**
 * Create a new room
 */
export async function createRoom(
  name: string,
  options?: { icon?: string; color?: string }
): Promise<Room> {
  const db = await getDatabase();

  const room: Room = {
    id: uuidv4(),
    name: name.trim(),
    icon: options?.icon,
    color: options?.color,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await db.add(STORES.ROOMS, room);
  return room;
}

/**
 * Get a room by ID
 */
export async function getRoom(id: string): Promise<Room | undefined> {
  const db = await getDatabase();
  return db.get(STORES.ROOMS, id);
}

/**
 * Get all rooms
 */
export async function getAllRooms(): Promise<Room[]> {
  const db = await getDatabase();
  return db.getAll(STORES.ROOMS);
}

/**
 * Get all rooms sorted by creation date (newest first)
 */
export async function getRoomsByCreated(): Promise<Room[]> {
  const db = await getDatabase();
  const rooms = await db.getAllFromIndex(STORES.ROOMS, 'by-created');
  return rooms.reverse(); // Newest first
}

/**
 * Update a room
 */
export async function updateRoom(
  id: string,
  updates: Partial<Omit<Room, 'id' | 'createdAt'>>
): Promise<Room | undefined> {
  const db = await getDatabase();

  const existing = await db.get(STORES.ROOMS, id);
  if (!existing) {
    return undefined;
  }

  const updated: Room = {
    ...existing,
    ...updates,
    updatedAt: Date.now(),
  };

  await db.put(STORES.ROOMS, updated);
  return updated;
}

/**
 * Delete a room and all its samples
 */
export async function deleteRoom(id: string): Promise<boolean> {
  const db = await getDatabase();

  // Start a transaction for both stores
  const tx = db.transaction([STORES.ROOMS, STORES.SAMPLES], 'readwrite');

  // Delete all samples for this room
  const sampleStore = tx.objectStore(STORES.SAMPLES);
  const sampleIndex = sampleStore.index('by-room');
  let cursor = await sampleIndex.openCursor(IDBKeyRange.only(id));

  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }

  // Delete the room
  await tx.objectStore(STORES.ROOMS).delete(id);
  await tx.done;

  return true;
}

/**
 * Get the count of rooms
 */
export async function getRoomCount(): Promise<number> {
  const db = await getDatabase();
  return db.count(STORES.ROOMS);
}

/**
 * Check if a room name already exists
 */
export async function roomNameExists(name: string): Promise<boolean> {
  const db = await getDatabase();
  const room = await db.getFromIndex(STORES.ROOMS, 'by-name', name.trim());
  return room !== undefined;
}
