import type { ChatStoreState } from '@/store/chat/initialState';

import { subSessionTreeKey } from './projection';

const EMPTY: never[] = [];

/** The sub-sessions fetched for one sidebar page; empty until loaded. */
const treeOf = (openerTopicIds: readonly string[]) => (s: ChatStoreState) =>
  s.subSessionTreeMap[subSessionTreeKey(openerTopicIds)] ?? EMPTY;

export const subSessionSelectors = { treeOf };
