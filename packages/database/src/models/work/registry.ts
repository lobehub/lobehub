import type { WorkType } from '@lobechat/types';

import { documentWorkAdapter } from './document';
import { externalWorkAdapter } from './external';
import { fileWorkAdapter } from './file';
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
  file: fileWorkAdapter,
  task: taskWorkAdapter,
} satisfies Record<WorkType, WorkTypeAdapter>;

export const WORK_TYPES = Object.keys(WORK_TYPE_ADAPTERS) as WorkType[];

/** Type-erased adapter list for uniform iteration in the aggregate queries. */
export const workTypeAdapters = Object.values(WORK_TYPE_ADAPTERS) as WorkTypeAdapter[];

/**
 * Work types gated behind an explicit client opt-in on the read path. `file` was
 * added after most clients shipped (Electron updates lag weeks): their bundled
 * descriptor table has no `file` entry, so a `file` work in the payload makes the
 * works UI look it up, get `undefined`, and throw on `descriptor.getIcon`. A
 * request that does not opt in therefore receives the pre-`file` set, keeping
 * every already-deployed client byte-identically safe; new clients opt in.
 */
const OPT_IN_WORK_TYPES = new Set<WorkType>(['file']);

/** The pre-`file` type set every already-deployed client is known to render. */
export const LEGACY_WORK_TYPES = WORK_TYPES.filter((type) => !OPT_IN_WORK_TYPES.has(type));

/**
 * Resolve the Work types a read request may return. Absent opt-in → the legacy
 * set (the read-path chokepoint that preserves old clients); opt-in → every
 * registered type. Used both for SQL row-level gating and to derive the adapter
 * fan-out below.
 */
export const resolveAllowedWorkTypes = (includeFileWorks?: boolean): WorkType[] =>
  includeFileWorks ? WORK_TYPES : LEGACY_WORK_TYPES;

/** Adapter fan-out list narrowed to the types the request is allowed to return. */
export const resolveWorkTypeAdapters = (includeFileWorks?: boolean): WorkTypeAdapter[] =>
  resolveAllowedWorkTypes(includeFileWorks).map((type) => WORK_TYPE_ADAPTERS[type]);
