import type { WorkType } from '@lobechat/types';

import { documentWorkAdapter } from './document';
import { externalWorkAdapter } from './external';
import type { WorkTypeAdapter } from './internal';
import { taskWorkAdapter } from './task';

/**
 * The single registry for Work-type query and display strategies. Adding a
 * Work type = adding one entry here (the `Record<WorkType, …>` constraint
 * turns a missing entry into a compile error, not a silently missing result
 * set) plus its type unions in `@lobechat/types`.
 */
export const WORK_TYPE_ADAPTERS = {
  document: documentWorkAdapter,
  external: externalWorkAdapter,
  task: taskWorkAdapter,
} satisfies Record<WorkType, WorkTypeAdapter>;

export const WORK_TYPES = Object.keys(WORK_TYPE_ADAPTERS) as WorkType[];

/** Type-erased adapter list for uniform iteration in the aggregate queries. */
export const workTypeAdapters = Object.values(WORK_TYPE_ADAPTERS) as WorkTypeAdapter[];
