import type {
  AgentInterventionRequestData,
  AgentInterventionResponseData,
  AgentStreamEvent,
} from '@lobechat/agent-gateway-client';
import type { LobeChatDatabase } from '@lobechat/database';
import type { ChannelAsk, ChannelAskInput } from '@lobechat/types';
import { channelAskInterventionResult, normalizeChannelAskInput } from '@lobechat/types';
import debug from 'debug';
import { and, eq, sql } from 'drizzle-orm';

import {
  closeInterventionAsk,
  postInterventionAsk,
} from '@/database/repositories/channel/interventionAsk';
import { agentOperations, messagePlugins, messages } from '@/database/schemas';
import { submitHeteroInterventionAs } from '@/server/routers/lambda/aiAgent/heteroInterventionSubmit';

import { notifyChannel } from './notify';

const log = debug('lobe-server:channel:intervention-ask');

/**
 * Tool plugin-state key marking a question that is also asked in a Channel. The topic's card
 * reads it to stop answering for the person on timeout: they may still be on their way from the
 * Channel, and a default option is not their decision.
 */
export const CHANNEL_ASK_PLUGIN_STATE_KEY = 'channelAsk';

/**
 * The questions a card can carry. Only a plain question whose answers are its option labels:
 * permission and plan prompts, and questions with provider-owned option ids, stay in the topic.
 */
const askInput = (data: AgentInterventionRequestData): ChannelAskInput | undefined => {
  if ((data.interactionKind ?? 'question') !== 'question') return;
  try {
    const args = JSON.parse(data.arguments) as {
      claudeCodePermission?: unknown;
      questions?: Array<{ options?: Array<{ id?: unknown }> }>;
    };
    if (args.claudeCodePermission) return;
    if (args.questions?.some((question) => question.options?.some((option) => !!option.id))) return;
    return normalizeChannelAskInput(args);
  } catch {
    // Out of a card's bounds (or not a question at all): it stays in the topic.
  }
};

/** Stamps the topic's tool message so its card stops answering for the person on timeout. */
const markToolMessage = async (
  db: LobeChatDatabase,
  topicId: string,
  toolCallId: string,
  state: { channelId: string; messageId: string },
) => {
  const [plugin] = await db
    .select({ id: messagePlugins.id })
    .from(messagePlugins)
    .innerJoin(messages, eq(messages.id, messagePlugins.id))
    .where(and(eq(messages.topicId, topicId), eq(messagePlugins.toolCallId, toolCallId)))
    .limit(1);
  if (!plugin) return;
  await db
    .update(messagePlugins)
    .set({
      state: sql`coalesce(${messagePlugins.state}, '{}'::jsonb) || ${JSON.stringify({ [CHANNEL_ASK_PLUGIN_STATE_KEY]: state })}::jsonb`,
    })
    .where(eq(messagePlugins.id, plugin.id));
};

/**
 * Follows a heterogeneous run's questions into the Channel it answers. A question the run blocks
 * on is posted as an `ask` card under the request, so the requester can answer it where they
 * asked; once the run settles the question anywhere else (answered in the topic, timed out,
 * ended), the card closes. A run that serves no Channel request is untouched. Best-effort: the
 * topic's own card keeps working whatever happens here.
 */
export const mirrorInterventionsToChannel = async (
  db: LobeChatDatabase,
  params: { events: AgentStreamEvent[]; operationId: string; topicId: string },
) => {
  const { events, operationId, topicId } = params;
  for (const event of events) {
    try {
      if (event.type === 'agent_intervention_request') {
        const data = event.data as AgentInterventionRequestData;
        const input = data?.toolCallId ? askInput(data) : undefined;
        if (!input) continue;
        const posted = await postInterventionAsk(
          db,
          { operationId, toolCallId: data.toolCallId },
          input,
        );
        if (!posted) continue;
        await markToolMessage(db, topicId, data.toolCallId, posted);
        await notifyChannel(db, posted.channelId);
      } else if (event.type === 'agent_intervention_response') {
        const data = event.data as AgentInterventionResponseData;
        if (!data?.toolCallId) continue;
        const channelId = await closeInterventionAsk(db, {
          operationId,
          toolCallId: data.toolCallId,
        });
        if (channelId) await notifyChannel(db, channelId);
      }
    } catch (error) {
      log('mirror %s failed op=%s: %O', event.type, operationId, error);
    }
  }
};

/**
 * Hands an answer given on a Channel card to the run blocked on it, as the run's owner: the same
 * path the topic's card answers through. Idempotent for the run, which ignores a question it
 * already settled.
 */
export const answerIntervention = async (db: LobeChatDatabase, ask: ChannelAsk) => {
  const { answer, intervention } = ask;
  if (!intervention || !answer) return;
  const [operation] = await db
    .select({ userId: agentOperations.userId, workspaceId: agentOperations.workspaceId })
    .from(agentOperations)
    .where(eq(agentOperations.id, intervention.operationId))
    .limit(1);
  if (!operation) throw new Error('The run that asked this question is gone');
  await submitHeteroInterventionAs(
    {
      operationId: intervention.operationId,
      result: channelAskInterventionResult(ask, answer.answers),
      stepIndex: 0,
      toolCallId: intervention.toolCallId,
    },
    operation,
  );
};
