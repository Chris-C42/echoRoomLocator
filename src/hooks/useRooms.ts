/**
 * useRooms - React hook for room management
 *
 * Provides:
 * - Room CRUD operations
 * - Reactive state updates
 * - Sample counts per room
 */

import { useState, useCallback, useEffect } from 'react';
import {
  Room,
  createRoom,
  getAllRooms,
  getRoom,
  updateRoom,
  deleteRoom,
  roomNameExists,
  getSampleCountsByRoom,
} from '../storage';

export interface RoomWithSampleCount extends Room {
  sampleCount: number;
}

export interface UseRoomsState {
  rooms: RoomWithSampleCount[];
  isLoading: boolean;
  error: string | null;
}

export interface UseRoomsReturn {
  state: UseRoomsState;
  addRoom: (name: string, options?: { icon?: string; color?: string }) => Promise<Room | null>;
  editRoom: (id: string, updates: { name?: string; icon?: string; color?: string }) => Promise<boolean>;
  removeRoom: (id: string) => Promise<boolean>;
  refreshRooms: () => Promise<void>;
  getRoomById: (id: string) => RoomWithSampleCount | undefined;
}

export function useRooms(): UseRoomsReturn {
  const [state, setState] = useState<UseRoomsState>({
    rooms: [],
    isLoading: true,
    error: null,
  });

  /**
   * Load all rooms with sample counts
   */
  const refreshRooms = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const [rooms, sampleCounts] = await Promise.all([
        getAllRooms(),
        getSampleCountsByRoom(),
      ]);

      const roomsWithCounts: RoomWithSampleCount[] = rooms.map((room) => ({
        ...room,
        sampleCount: sampleCounts.get(room.id) || 0,
      }));

      // Sort by creation date (newest first)
      roomsWithCounts.sort((a, b) => b.createdAt - a.createdAt);

      setState({
        rooms: roomsWithCounts,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load rooms';
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: message,
      }));
    }
  }, []);

  // Load rooms on mount
  useEffect(() => {
    refreshRooms();
  }, [refreshRooms]);

  /**
   * Add a new room
   */
  const addRoom = useCallback(async (
    name: string,
    options?: { icon?: string; color?: string }
  ): Promise<Room | null> => {
    try {
      // Check if name already exists
      const exists = await roomNameExists(name);
      if (exists) {
        setState((prev) => ({
          ...prev,
          error: `A room named "${name}" already exists`,
        }));
        return null;
      }

      const room = await createRoom(name, options);

      // Update local state
      setState((prev) => ({
        ...prev,
        rooms: [{ ...room, sampleCount: 0 }, ...prev.rooms],
        error: null,
      }));

      return room;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create room';
      setState((prev) => ({ ...prev, error: message }));
      return null;
    }
  }, []);

  /**
   * Edit an existing room
   */
  const editRoom = useCallback(async (
    id: string,
    updates: { name?: string; icon?: string; color?: string }
  ): Promise<boolean> => {
    try {
      // Check if new name already exists (if name is being changed)
      if (updates.name) {
        const currentRoom = await getRoom(id);
        if (currentRoom && currentRoom.name !== updates.name) {
          const exists = await roomNameExists(updates.name);
          if (exists) {
            setState((prev) => ({
              ...prev,
              error: `A room named "${updates.name}" already exists`,
            }));
            return false;
          }
        }
      }

      const updated = await updateRoom(id, updates);
      if (!updated) {
        setState((prev) => ({ ...prev, error: 'Room not found' }));
        return false;
      }

      // Update local state
      setState((prev) => ({
        ...prev,
        rooms: prev.rooms.map((room) =>
          room.id === id ? { ...room, ...updated } : room
        ),
        error: null,
      }));

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update room';
      setState((prev) => ({ ...prev, error: message }));
      return false;
    }
  }, []);

  /**
   * Remove a room (and all its samples)
   */
  const removeRoom = useCallback(async (id: string): Promise<boolean> => {
    try {
      await deleteRoom(id);

      // Update local state
      setState((prev) => ({
        ...prev,
        rooms: prev.rooms.filter((room) => room.id !== id),
        error: null,
      }));

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete room';
      setState((prev) => ({ ...prev, error: message }));
      return false;
    }
  }, []);

  /**
   * Get a room by ID from local state
   */
  const getRoomById = useCallback((id: string): RoomWithSampleCount | undefined => {
    return state.rooms.find((room) => room.id === id);
  }, [state.rooms]);

  return {
    state,
    addRoom,
    editRoom,
    removeRoom,
    refreshRooms,
    getRoomById,
  };
}
