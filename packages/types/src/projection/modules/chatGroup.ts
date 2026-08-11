import type { ProjectionRef, ProjectionSource } from '../base';

export type ChatGroupListIndexKey = 'chatGroup.list';

export interface ChatGroupListIndex {
  key: ChatGroupListIndexKey;
  observedAt: number;
  refs: ProjectionRef<'chatGroup'>[];
  source: ProjectionSource;
}

export interface ChatGroupIndexMap {
  'chatGroup.list': ChatGroupListIndex;
}
