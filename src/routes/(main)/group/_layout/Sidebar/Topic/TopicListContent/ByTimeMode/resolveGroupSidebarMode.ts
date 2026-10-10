import type { TopicGroupMode } from '@/types/topic';

/**
 * The group-chat sidebar renders every non-flat preference through its time
 * renderer, but its menu never offers `byAgent` and group topics carry no
 * per-row agent attribution. When a project-scoped sidebar persists `byAgent`
 * into the global preference, grouping by it here would emit `agent:*` buckets
 * that this surface's headers format as time-bucket translation keys — so the
 * mode falls back to the default time grouping.
 */
export const resolveGroupSidebarMode = (mode: TopicGroupMode): TopicGroupMode =>
  mode === 'byAgent' ? 'byTime' : mode;
