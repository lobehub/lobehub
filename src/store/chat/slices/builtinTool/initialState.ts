import { type FileItem } from '@/types/files';

export interface ChatToolState {
  activePageContentUrl?: string;
  codeInterpreterFileMap: Record<string, FileItem>;
  codeInterpreterImageMap: Record<string, FileItem>;
}

export const initialToolState: ChatToolState = {
  codeInterpreterFileMap: {},
  codeInterpreterImageMap: {},
};
