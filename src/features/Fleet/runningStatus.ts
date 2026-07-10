import type { ChatTopicStatus } from '@/types/topic';

interface GetFleetSidebarStatusParams {
  isRuntimeRunning: boolean;
  status: ChatTopicStatus | undefined;
  visibleStartedAt: number | undefined;
}

export const getFleetSidebarStatus = ({
  isRuntimeRunning,
  status,
  visibleStartedAt,
}: GetFleetSidebarStatusParams): ChatTopicStatus | undefined => {
  // Example: visible_output_end hides the elapsed timer while the runtime still
  // waits for terminal bookkeeping. Topic status can remain "running", but the
  // Fleet sidebar should not keep showing a spinning running dot in that tail.
  if (isRuntimeRunning && visibleStartedAt === undefined && status === 'running') {
    return 'completed';
  }

  return status;
};
