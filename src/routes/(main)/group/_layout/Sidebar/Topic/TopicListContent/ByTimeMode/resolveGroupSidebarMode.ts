import type { TopicGroupMode } from '@/types/topic';

/**
 * The group-chat sidebar renders every non-flat preference through its time
 * renderer, but its menu never offers `byAgent` / `byDevice` and group topics
 * carry no per-row agent or device attribution. When a project-scoped sidebar
 * persists one of them into the global preference, grouping by it here would
 * emit `agent:*` / `device:*` buckets that this surface's headers format as
 * time-bucket translation keys — so the mode falls back to the default time
 * grouping.
 */
export const resolveGroupSidebarMode = (mode: TopicGroupMode): TopicGroupMode =>
  mode === 'byAgent' || mode === 'byDevice' ? 'byTime' : mode;
