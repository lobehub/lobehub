import type { TaskDetailData } from '@lobechat/types';

import { defineReplica } from '@/libs/replica';

/**
 * One task detail per entry, keyed by the id it was opened with — the
 * identifier (`T-12`) or a raw row id (`task_xxx`); a raw-id fetch also writes
 * the identifier entry.
 */
export const taskDetailResource = defineReplica<string, TaskDetailData>({
  key: (id) => id,
  name: 'taskDetail',
  storage: 'indexedDB',
  version: 1,
});
