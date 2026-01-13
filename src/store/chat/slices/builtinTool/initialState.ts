import { type FileItem } from '@/types/files';

export interface ChatToolState {
  activePageContentUrl?: string;
  codeInterpreterImageMap: Record<string, FileItem>;
}

export const initialToolState: ChatToolState = {
  codeInterpreterImageMap: {},
};
