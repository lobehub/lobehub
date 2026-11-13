import { RequestTrigger } from '@lobechat/types';
import { and, eq, exists, isNull, notInArray, or, sql } from 'drizzle-orm';

import { agentEvalDatasets, agents, topics, userConnectors } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { CHANNEL_TOPIC_TRIGGER } from '../utils/topicVisibility';
import { buildWorkspaceWhere, normalizeWorkspaceId } from '../utils/workspace';

/**
 * Shared by connection rows and their tool rows; default access is ordinary-only.
 *
 * Visibility-aware in a workspace (`buildWorkspaceWhere` reads
 * `user_connectors.visibility`): every member sees the shared rows, and only
 * the creator sees a private one. This is the management view; runtime
 * resolution uses {@link connectorRunScope}.
 */
export const connectorAccessScope = (
  db: LobeChatDatabase,
  scope: { userId: string; workspaceId?: string },
  datasetId?: string,
) =>
  and(
    buildWorkspaceWhere(scope, userConnectors),
    datasetId
      ? and(
          sql`${userConnectors.metadata} -> 'agentEval' ->> 'datasetId' = ${datasetId}`,
          exists(
            db
              .select({ id: agentEvalDatasets.id })
              .from(agentEvalDatasets)
              .where(
                and(
                  eq(agentEvalDatasets.id, datasetId),
                  buildWorkspaceWhere(scope, agentEvalDatasets),
                ),
              ),
          ),
        )
      : ordinaryConnection(),
  );

const ordinaryConnection = () => sql`COALESCE(${userConnectors.metadata} ->> 'agentEval', '') = ''`;

/**
 * What a runtime resolution runs as: the agent whose tools are being built and
 * the topic its results are written into.
 */
export interface ConnectorRunTarget {
  agentId?: string;
  /**
   * The conversation the run writes into. A private agent loads its owner's
   * private connectors only when this is the agent's own direct topic; without
   * it the run resolves the workspace's shared connectors only.
   */
  topicId?: string;
}

/**
 * Topic triggers whose transcript is read by people other than the run's
 * user: a Channel run publishes its reply to the channel, a bot run posts into
 * an IM chat, and a share run is read by the share visitor.
 */
const NON_PRIVATE_TOPIC_TRIGGERS: string[] = [
  CHANNEL_TOPIC_TRIGGER,
  RequestTrigger.AgentShare,
  RequestTrigger.Bot,
];

const personalRows = (userId: string) =>
  and(eq(userConnectors.userId, userId), isNull(userConnectors.workspaceId), ordinaryConnection());

const sharedRows = (workspaceId: string) =>
  and(eq(userConnectors.workspaceId, workspaceId), eq(userConnectors.visibility, 'public'));

/**
 * The caller's private rows in this workspace and their personal rows, when
 * `agentId` is the caller's own private agent in this workspace. Checked in SQL
 * (an uncorrelated EXISTS, evaluated once per query), so a caller cannot widen
 * the scope by naming an agent it does not own.
 */
const ownersPrivateRows = (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string,
  agentId: string,
) =>
  and(
    eq(userConnectors.userId, userId),
    or(
      and(eq(userConnectors.workspaceId, workspaceId), eq(userConnectors.visibility, 'private')),
      isNull(userConnectors.workspaceId),
    ),
    exists(
      db
        .select({ id: agents.id })
        .from(agents)
        .where(
          and(
            eq(agents.id, agentId),
            eq(agents.workspaceId, workspaceId),
            eq(agents.userId, userId),
            eq(agents.visibility, 'private'),
          ),
        ),
    ),
  );

/**
 * Base connector rows (before the agent-owned / mount narrowing) a run may
 * resolve. Tool visibility follows the agent, never whoever is speaking:
 *
 * - Personal run: the user's personal rows.
 * - Workspace run, any agent: the workspace's shared (`public`) rows.
 * - Workspace run of a PRIVATE agent, by its owner, inside the agent's own
 *   direct topic: also the owner's private rows in this workspace and the
 *   owner's personal rows (`workspace_id IS NULL`).
 *
 * "Own direct topic" means the topic belongs to this agent and this user, is
 * not a group topic, and is not a channel / bot / share transcript. A private
 * agent can still be pulled into conversations other members read (a group
 * supervisor dispatch, `callAgent` from a shared agent, a topic of another
 * agent); there the topic proof fails and the private rows stay out, so a
 * private connector's results never land in a shared conversation. Without a
 * `topicId` the run gets the shared rows only.
 *
 * Every check is in SQL (two uncorrelated EXISTS, evaluated once per query), so
 * a caller cannot widen the scope by passing an agent or topic it does not own.
 */
export const connectorRunScope = (
  db: LobeChatDatabase,
  scope: { userId: string; workspaceId?: string },
  target: ConnectorRunTarget,
) => {
  const workspaceId = normalizeWorkspaceId(scope.workspaceId);
  if (!workspaceId) return personalRows(scope.userId);

  const { agentId, topicId } = target;
  if (!agentId || !topicId) return and(sharedRows(workspaceId), ordinaryConnection());

  const ownDirectTopic = db
    .select({ id: topics.id })
    .from(topics)
    .where(
      and(
        eq(topics.id, topicId),
        eq(topics.agentId, agentId),
        eq(topics.userId, scope.userId),
        eq(topics.workspaceId, workspaceId),
        isNull(topics.groupId),
        isNull(topics.senderId),
        or(isNull(topics.trigger), notInArray(topics.trigger, NON_PRIVATE_TOPIC_TRIGGERS)),
      ),
    );

  return and(
    or(
      sharedRows(workspaceId),
      and(ownersPrivateRows(db, scope.userId, workspaceId, agentId), exists(ownDirectTopic)),
    ),
    ordinaryConnection(),
  );
};

/**
 * Base connector rows an agent's CONFIGURATION may name: what the agent loads
 * in its own direct topic (see {@link connectorRunScope}), so an owner can pin
 * their private connector on their private agent. Nothing runs and no result is
 * written under this scope, which is why it needs no topic proof; a run still
 * resolves through {@link connectorRunScope}, and in a group, channel or another
 * agent's topic the private rows stay out.
 */
export const connectorAgentConfigScope = (
  db: LobeChatDatabase,
  scope: { userId: string; workspaceId?: string },
  agentId?: string,
) => {
  const workspaceId = normalizeWorkspaceId(scope.workspaceId);
  if (!workspaceId) return personalRows(scope.userId);
  if (!agentId) return and(sharedRows(workspaceId), ordinaryConnection());

  return and(
    or(sharedRows(workspaceId), ownersPrivateRows(db, scope.userId, workspaceId, agentId)),
    ordinaryConnection(),
  );
};
