import type { ProjectionRef, ProjectionSource } from '../base';
import { defineProjectionKeySpace } from '../runtime';

export const CHAT_GROUP_INDEX_KEYS = {
  list: 'chatGroup.list',
} as const;

export const chatGroupIndexKeySpace = defineProjectionKeySpace({
  patterns: [],
  staticKeys: Object.values(CHAT_GROUP_INDEX_KEYS),
});

export type ChatGroupListIndexKey = typeof CHAT_GROUP_INDEX_KEYS.list;

export interface ChatGroupListIndex {
  key: ChatGroupListIndexKey;
  observedAt: number;
  refs: ProjectionRef<'chatGroup'>[];
  source: ProjectionSource;
}

export type ChatGroupIndexMap = { [K in ChatGroupListIndexKey]: ChatGroupListIndex };
