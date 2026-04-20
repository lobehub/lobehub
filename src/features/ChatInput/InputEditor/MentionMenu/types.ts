import type { ISlashMenuOption } from '@lobehub/editor';
import type { ReactNode } from 'react';

export type MentionCategoryId = 'agent' | 'topic' | 'member' | 'skill' | 'tool';

export interface MentionCategory {
  icon: ReactNode;
  id: MentionCategoryId;
  items: ISlashMenuOption[];
  label: string;
}

export interface MentionMenuState {
  isSearch: boolean;
  matchingString: string;
}

export const CATEGORY_KEY_PREFIX = '__category__';

export const isCategoryEntry = (key: string): boolean => key.startsWith(CATEGORY_KEY_PREFIX);

export const getCategoryIdFromKey = (key: string): MentionCategoryId =>
  key.slice(CATEGORY_KEY_PREFIX.length) as MentionCategoryId;
