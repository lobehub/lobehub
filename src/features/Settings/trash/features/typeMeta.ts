import type { ResourceTrashType } from '@lobechat/types';
import { FileIcon, FileTextIcon, LibraryIcon } from 'lucide-react';

/** Icon per recycle-bin resource kind — mirrors the sidebar / recents glyphs. */
export const TRASH_TYPE_ICON: Record<ResourceTrashType, typeof FileIcon> = {
  document: FileTextIcon,
  file: FileIcon,
  knowledgeBase: LibraryIcon,
};

/** Order the type filter shows kinds in — most-deleted first. */
export const TRASH_TYPE_ORDER: ResourceTrashType[] = ['file', 'document', 'knowledgeBase'];
