import type { AgentRuntimeContext, AgentState } from '@lobechat/agent-runtime';
import { findCurrentTurnPendingToolMessages } from '@lobechat/agent-runtime';
import { isGoalPrompt } from '@lobechat/builtin-tool-goal';
import type { ConversationContext, MessageMetadata } from '@lobechat/types';
import { COMPOSER_USER_MESSAGE_METADATA_KEYS } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import debug from 'debug';

import { messageService } from '@/services/message';
import {
  parseActionTagsFromEditorData,
  parseMentionedAgentsFromEditorData,
} from '@/store/chat/slices/agentRun/actions/entries/commandBus/parseCommands';
import { mergeQueuedMessages, type QueuedMessage } from '@/store/chat/slices/operation/types';
import type { ChatStore } from '@/store/chat/store';

const log = debug('lobe-store:client-steer');

/** The decision points right before the run calls the model again — where the server steers too. */
const LLM_NEXT_PHASES = new Set([
  'tool_result',
  'tools_batch_result',
  'sub_agent_result',
  'sub_agents_batch_result',
]);

/**
 * Whether a queued message can join a running client turn: plain text sent
 * from the composer. Attachments, quoted selections, a pinned runtime or
 * anything else that needs a turn configured for it waits for a turn of its
 * own, as it did before.
 */
export const canSteerClientRun = (message: QueuedMessage): boolean => {
  if (!message.content.trim()) return false;
  if (message.files?.length || message.filesPreview?.length) return false;
  if (message.forceRuntime) return false;
  // Tool and skill selections, commands and @-mentions live in the rich text and
  // are turned into turn context only by a send of their own.
  if (parseActionTagsFromEditorData(message.editorData).length > 0) return false;
  if (parseMentionedAgentsFromEditorData(message.editorData).length > 0) return false;
  if (isGoalPrompt(message.content)) return false;
  const metadata = message.metadata as Record<string, unknown> | undefined;
  return !COMPOSER_USER_MESSAGE_METADATA_KEYS.some((key) => {
    const value = metadata?.[key];
    return Array.isArray(value) ? value.length > 0 : value !== undefined;
  });
};

export interface SteeredStep {
  nextContext: AgentRuntimeContext;
  state: AgentState;
}

/**
 * Steer a running client turn (Follow-up behavior: Steer): at a decision point
 * right before the next model call, take the leading queued messages that can
 * join into the run as ONE steer user message, and go on with the same run on
 * top of it — the way the server joins its queue (`injectQueuedFollowUp`).
 *
 * Nothing is taken while a tool waits for the user's approval: the messages
 * stay queued until the approval settles. Messages that cannot join stay in
 * the queue too; the run then hands its turn back for them as before.
 *
 * @returns the step to run instead, or `undefined` when nothing joined
 */
export const steerQueuedFollowUps = async (
  get: () => ChatStore,
  params: {
    context: ConversationContext;
    contextKey: string;
    nextContext: AgentRuntimeContext;
    operationId: string;
    state: AgentState;
  },
): Promise<SteeredStep | undefined> => {
  const { context, contextKey, nextContext, operationId, state } = params;
  if (!LLM_NEXT_PHASES.has(nextContext.phase)) return;
  if (findCurrentTurnPendingToolMessages(state.messages).length > 0) return;

  const queue = get().queuedMessages[contextKey] ?? [];
  const firstHeld = queue.findIndex((message) => !canSteerClientRun(message));
  const joinable = firstHeld === -1 ? queue.length : firstHeld;
  if (joinable === 0) return;

  const taken = get().drainQueuedMessages(contextKey, { limit: joinable });
  if (taken.length === 0) return;

  const merged = mergeQueuedMessages(taken);
  const parentId = (nextContext.payload as { parentMessageId?: string } | undefined)
    ?.parentMessageId;
  const id = nanoid();
  const metadata: MessageMetadata = { ...merged.metadata, steer: true };
  const message = {
    agentId: context.agentId,
    content: merged.content,
    editorData: merged.editorData,
    groupId: context.groupId ?? undefined,
    id,
    metadata,
    parentId,
    role: 'user' as const,
    threadId: context.threadId ?? undefined,
    topicId: context.topicId ?? undefined,
  };

  get().internal_dispatchMessage(
    { id, type: 'createMessage', value: { ...message } },
    { operationId },
    { creationOrigin: 'client' },
  );
  try {
    await messageService.createMessage(message);
  } catch (error) {
    // Not in the conversation: the messages go back to the head of the queue,
    // and the run hands its turn back for them.
    console.error('[clientSteer] writing the steer message failed:', error);
    get().internal_dispatchMessage({ id, type: 'deleteMessage' }, { operationId });
    get().requeueQueuedMessages(contextKey, taken);
    return;
  }
  get().internal_confirmClientMessages([id]);
  log('[%s] Joined %d queued messages as %s', operationId, taken.length, id);

  const now = Date.now();
  return {
    nextContext: {
      ...nextContext,
      payload: { parentMessageId: id },
      phase: 'user_input',
    } as AgentRuntimeContext,
    state: {
      ...state,
      lastModified: new Date(now).toISOString(),
      messages: [
        ...state.messages,
        { ...message, createdAt: now, updatedAt: now } as AgentState['messages'][number],
      ],
    },
  };
};
