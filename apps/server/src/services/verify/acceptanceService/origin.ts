import { AgentModel } from '@/database/models/agent';
import { TopicModel } from '@/database/models/topic';
import type { VerifyRunItem } from '@/database/schemas/verify';

import type { AcceptanceServiceDeps } from './deps';

/**
 * The authoring conversation behind the round chain, resolved to displayable
 * entities (agent avatar/title, topic title). Owner-only header data — the
 * bundle must not include it for anonymous link holders.
 */
export const resolveOrigin = async (
  deps: AcceptanceServiceDeps,
  runs: VerifyRunItem[],
): Promise<{
  agent: {
    avatar: string | null;
    backgroundColor: string | null;
    id: string;
    title: string | null;
  } | null;
  topic: { id: string; title: string | null } | null;
} | null> => {
  const origin = [...runs].reverse().find((run) => run.metadata?.origin)?.metadata?.origin;
  if (!origin?.agentId && !origin?.topicId) return null;

  const topicRowPromise = origin.topicId
    ? new TopicModel(deps.db, deps.userId, deps.workspaceId)
        .findById(origin.topicId)
        .catch(() => null)
    : Promise.resolve(null);
  // Dispatched runs (task / goal / device) record only the topic — the
  // connector strips the ambient agent id — so the topic's own agent stands in.
  // A recorded agent does not wait on the topic read.
  const agentPromise = (
    origin.agentId ? Promise.resolve(origin.agentId) : topicRowPromise.then((row) => row?.agentId)
  ).then((agentId) =>
    agentId
      ? new AgentModel(deps.db, deps.userId, deps.workspaceId)
          .getAgentAvatarsByIds([agentId])
          .then((rows) => rows[0] ?? null)
          .catch(() => null)
      : null,
  );
  const [topicRow, agent] = await Promise.all([topicRowPromise, agentPromise]);
  const topic = topicRow ? { id: topicRow.id, title: topicRow.title ?? null } : null;
  if (!agent && !topic) return null;
  return { agent, topic };
};

/**
 * The raw authoring conversation behind the latest round that recorded one —
 * the ids a rejected delivery is sent back to. Unlike {@link resolveOrigin}
 * nothing is hydrated: the dispatcher re-reads the topic under the caller's
 * own scope.
 */
export const findRepairOrigin = async (
  deps: AcceptanceServiceDeps,
  acceptanceId: string,
): Promise<{ agentId?: string; topicId?: string } | null> => {
  const runs = await deps.runModel.listByAcceptance(acceptanceId);
  const origin = [...runs].reverse().find((run) => run.metadata?.origin)?.metadata?.origin;
  if (!origin?.topicId) return null;
  return { agentId: origin.agentId || undefined, topicId: origin.topicId };
};
