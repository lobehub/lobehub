import type { ISlashMenuOption } from '@lobehub/editor';

export interface UseLocalFileMentionResult {
  enableLocalFileMention: boolean;
  searchLocalFiles: (matchingString: string) => Promise<ISlashMenuOption[]>;
}

const searchLocalFiles = async (): Promise<ISlashMenuOption[]> => [];

export const useLocalFileMention = (): UseLocalFileMentionResult => ({
  enableLocalFileMention: false,
  searchLocalFiles,
});
