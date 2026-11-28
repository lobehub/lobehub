import type { ChatTopic } from '@lobechat/types';

import { aiAgentService } from '@/services/aiAgent';

type RunningOperationMarker = NonNullable<NonNullable<ChatTopic['metadata']>['runningOperation']>;

/**
 * Whether the server parked this operation on a human answer.
 *
 * The topic marker cannot tell a dropped-but-alive run from one parked on a
 * question: the server keeps `runningOperation` through `waiting_for_human`
 * (`settleTopicRunningMark` skips in-flight statuses). Yet a parked operation
 * never streams again — the answer resumes under a new operation id
 * (`AgentRuntimeCoordinator` treats `waiting_for_human` as stream-terminal).
 * Reading the marker alone kept a tab that missed the park's terminal frame
 * (for example a desktop window whose socket dropped while the Mac slept)
 * showing the run as working forever, with no question card, while a fresh web
 * tab showed the card at once (lobehub#23933).
 *
 * False when the status cannot be read: an unreadable status is not evidence
 * that the stream ended.
 */
const isParkedOnHuman = async (serverOperationId: string): Promise<boolean> => {
  try {
    const status = await aiAgentService.getOperationStatus({ operationId: serverOperationId });
    return status?.currentState?.status === 'waiting_for_human';
  } catch (error) {
    console.error('[Gateway] Silent-end operation status read failed:', error);
    return false;
  }
};

/**
 * Whether a silently-ended run's subscription is over, judged from the topic's
 * `runningOperation` marker as read from the server.
 *
 * - No marker, or a marker naming another run: this run is over.
 * - A marker naming this run, directly or as a member continuation listed in
 *   `childOperations` (the same ownership test the server's own settle uses):
 *   the run is alive unless the server parked it on a human answer, which ends
 *   this operation's stream.
 */
export const isRunOverByMarker = async (
  runningOperation: RunningOperationMarker | null | undefined,
  serverOperationId: string,
): Promise<boolean> => {
  if (!runningOperation) return true;

  const namesThisRun =
    runningOperation.operationId === serverOperationId ||
    !!runningOperation.childOperations?.some((child) => child.operationId === serverOperationId);
  if (!namesThisRun) return true;

  return isParkedOnHuman(serverOperationId);
};
