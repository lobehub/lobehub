/**
 * Thread-list filter by the subagent preset that ran each thread:
 * `all` keeps every row, `main` keeps threads the main agent ran directly
 * (`subagentId` null — including every thread created before presets existed),
 * any other value is a preset id.
 */
export type SubagentFilter = 'all' | 'main' | (string & {});

export const SUBAGENT_FILTER_ALL = 'all';
export const SUBAGENT_FILTER_MAIN = 'main';

export const filterThreadsBySubagent = <T extends { subagentId?: string | null }>(
  threads: readonly T[],
  filter: SubagentFilter,
): T[] => {
  if (filter === SUBAGENT_FILTER_ALL) return [...threads];
  if (filter === SUBAGENT_FILTER_MAIN) return threads.filter((thread) => !thread.subagentId);
  return threads.filter((thread) => thread.subagentId === filter);
};

/** Distinct preset ids among the threads, in first-seen order. */
export const collectSubagentIds = (threads: readonly { subagentId?: string | null }[]) => [
  ...new Set(threads.flatMap((thread) => (thread.subagentId ? [thread.subagentId] : []))),
];
