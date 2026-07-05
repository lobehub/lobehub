import { StateCreator } from 'zustand';
import { FileItem, FileMap } from '@/types/file';
import { FileManagerSlice } from './store';

export interface FileManagerActions {
  /**
   * Add a file.
   */
  addFile: (file: FileItem) => void;
  /**
   * Update a file by ID.
   */
  updateFile: (id: string, updates: Partial<FileItem>) => void;
  /**
   * Delete a file by ID.
   */
  deleteFile: (id: string) => void;
  /**
   * Get all files as an array.
   */
  getFiles: () => FileItem[];
}

export const createFileManagerActions: StateCreator<
  FileManagerSlice,
  [],
  [],
  FileManagerActions
> = (set, get) => ({
  addFile: (file) => {
    set((state) => ({
      files: { ...state.files, [file.id]: file },
    }));
  },
  updateFile: (id, updates) => {
    const current = get().files[id];
    if (!current) return;
    const updated = { ...current, ...updates };
    set((state) => ({
      files: { ...state.files, [id]: updated },
    }));
  },
  deleteFile: (id) => {
    set((state) => {
      const { [id]: _, ...rest } = state.files;
      return { files: rest };
    });
  },
  getFiles: () => Object.values(get().files),
});
