import {
  AGENT_SHARE_DEFAULT_MAX_MESSAGES_PER_VISITOR,
  SHARE_VISITOR_PROMPT_MAX_LENGTH,
} from '@lobechat/const';
import { ChatErrorType } from '@lobechat/types';
import { eq } from 'drizzle-orm';

import { TopicModel } from '../../models/topic';
import { agents, agentShares } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { ChannelError } from './error';

/**
 * Admission for a message sent to another person's shared Agent, with the limits its share page
 * applies to a visitor, so the composer is told at send time instead of the reply failing later.
 *
 * - The prompt length cap (`SHARE_VISITOR_PROMPT_MAX_LENGTH`).
 * - `maxMessagesPerVisitor`: the messages this visitor has sent to the Agent in total, across
 *   every conversation, the same count the run's own atomic guard (`reserveShareVisitorTurn`)
 *   applies when it writes the visitor's message.
 *
 * Like the spend limit, a send-time guardrail rather than an atomic reservation: concurrent sends
 * can each pass here, and the run's guard refuses the one beyond the cap.
 */
export const assertSharedAgentAdmission = async (
  tx: Transaction,
  params: { agentId: string; content: string; ownerId: string; visitorId: string },
) => {
  const { agentId, content, ownerId, visitorId } = params;
  if (content.length > SHARE_VISITOR_PROMPT_MAX_LENGTH)
    throw new ChannelError(
      'BAD_REQUEST',
      `Messages to a shared Agent are limited to ${SHARE_VISITOR_PROMPT_MAX_LENGTH} characters`,
    );

  const [share] = await tx
    .select({ config: agentShares.shareConfig, workspaceId: agents.workspaceId })
    .from(agentShares)
    .innerJoin(agents, eq(agents.id, agentShares.agentId))
    .where(eq(agentShares.agentId, agentId))
    .limit(1);
  const limit =
    share?.config?.maxMessagesPerVisitor ?? AGENT_SHARE_DEFAULT_MAX_MESSAGES_PER_VISITOR;
  const sent = await new TopicModel(
    tx as unknown as LobeChatDatabase,
    ownerId,
    share?.workspaceId ?? undefined,
    undefined,
    { includeShareVisitor: true },
  ).countMessagesBySender({ agentId, senderId: visitorId });
  if (sent < limit) return;
  // The message is the error type, as the share page's refusal is: the composer reads it to
  // explain the refusal in the visitor's language.
  throw new ChannelError('TOO_MANY_REQUESTS', ChatErrorType.ShareMessageLimitExceeded);
};
