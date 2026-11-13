import type { TaskDetailData } from '@lobechat/types';

import { defineReplica } from '@/libs/replica';

/** Canonical task ids only. Display aliases live in the in-memory ref index. */
export const taskDetailResource = defineReplica<string, TaskDetailData>({
  key: (id) => id,
  name: 'taskDetail',
  storage: 'indexedDB',
  version: 2,
});
