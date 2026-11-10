import { isAgentOperationInFlight } from '@lobechat/types';

import type { AgentOperationModel } from '@/database/models/agentOperation';

import { VERIFY_SETTLE_GRACE_MS } from './recoveryPolicy';

/**
 * Bound on the delivered topic's operations read when dating its last activity.
 * A repair spawns child operations into the same topic, so a small newest-first
 * sample could miss the long-lived root that is still heartbeating; a topic
 * never holds anywhere near this many runs.
 */
const MAX_TOPIC_OPERATIONS = 500;

interface DeliveredTopic {
  completedAt: Date | null;
  createdAt: Date;
  status: string | null;
  topicId: string | null;
}

/**
 * Whether a delivered Task may still be settling its verification, so the
 * coordinator must not re-dispatch it.
 *
 * A verify-bound Task keeps its task `running` with a *completed* topic until
 * the verify run settles. That settle is not one judgment: a failed check sends
 * an auto-repair operation back into the same delivered topic, and the repaired
 * round is judged again after it. The topic row stays `completed` throughout, so
 * the grace window counts from the delivery's last sign of life — the newest
 * operation heartbeat or completion in that topic — not from the original
 * delivery. Counting from the delivery re-dispatched a second attempt an hour
 * in, beside a repair that was still running.
 */
export const isDeliverySettling = async (
  operationModel: AgentOperationModel,
  topic: DeliveredTopic | undefined,
): Promise<boolean> => {
  if (topic?.status !== 'completed') return false;

  let lastActivity = new Date(topic.completedAt ?? topic.createdAt).getTime();
  if (topic.topicId) {
    const recent = await operationModel.listByTopic(topic.topicId, MAX_TOPIC_OPERATIONS);
    const operations = await operationModel.findByIds(recent.map((operation) => operation.id));
    for (const operation of operations) {
      if (!isAgentOperationInFlight(operation.status)) {
        const endedAt = operation.completedAt ?? operation.updatedAt;
        lastActivity = Math.max(lastActivity, new Date(endedAt).getTime());
        continue;
      }
      // A repair parked for a person, a client or an async tool is legitimately
      // quiet and can still resume: its stale heartbeat says nothing about it.
      if (operation.status.startsWith('waiting_for_')) return true;
      lastActivity = Math.max(lastActivity, new Date(operation.updatedAt).getTime());
    }
  }

  return lastActivity >= Date.now() - VERIFY_SETTLE_GRACE_MS;
};
