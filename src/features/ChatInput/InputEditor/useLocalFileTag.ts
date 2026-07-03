import type { ISlashMenuOption } from '@lobehub/editor';

export interface UseLocalFileTagResult {
  enableLocalFileTag: boolean;
  searchLocalFiles: (matchingString: string) => Promise<ISlashMenuOption[]>;
}

const searchLocalFiles = async (): Promise<ISlashMenuOption[]> => [];

export const useLocalFileTag = (): UseLocalFileTagResult => ({
  enableLocalFileTag: false,
  searchLocalFiles,
});
