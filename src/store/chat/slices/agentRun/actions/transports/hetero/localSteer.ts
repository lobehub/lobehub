import type { HeterogeneousAgentType } from '@lobechat/heterogeneous-agents';
import type { ConversationContext } from '@lobechat/types';
import debug from 'debug';

import { heterogeneousAgentService } from '@/services/electron/heterogeneousAgent';
import { messageService } from '@/services/message';
import { mergeQueuedMessages, type QueuedMessage } from '@/store/chat/slices/operation/types';
import { type ChatStore, useChatStore } from '@/store/chat/store';

import { getFollowUpMode } from '../../lifecycle/followUpMode';
import { canSteerClientRun } from '../client/clientSteer';

const log = debug('lobe-store:local-steer');

/**
 * Whether a local heterogeneous run can take a message mid-run: Claude Code
 * (SDK input stream, or a CLI whose input stays open), Codex over app-server
 * (`turn/steer`) and Pi (`steer`). The others — ACP agents, one-shot CLIs,
 * Codex `exec` — send it once the run ends.
 */
export const supportsLocalSteer = (
  agentType: HeterogeneousAgentType | string,
  options: { codexAppServer?: boolean },
): boolean =>
  agentType === 'claude-code' ||
  agentType === 'pi' ||
  (agentType === 'codex' && !!options.codexAppServer);

/** A `step_complete { phase: 'user_message' }` event: the agent read a user message. */
export interface SteerConfirmation {
  text?: string;
  uuid?: string;
}

export interface LocalSteerOptions {
  context: ConversationContext;
  /** Queue key the run's follow-ups wait under. */
  contextKey: string;
  get: () => ChatStore;
  ipcSessionId: string;
  /** Whether the run waits for the user (a pending question or approval); nothing is steered then. */
  isWaitingForUser: () => boolean;
  operationId: string;
  /** The message the next steer user message parents off (the run's spine), and its update. */
  spine: { get: () => string; set: (id: string) => void };
  subscribe: (listener: () => void) => () => void;
}

interface PendingSteer {
  content: string;
  messageId: string;
  /** `delivering` until the IPC answers; `written` once accepted, until the agent reads it. */
  state: 'delivering' | 'written';
  taken: QueuedMessage[];
}

/**
 * Steer a local heterogeneous run (Follow-up behavior: Steer). The leading
 * queued messages that can join are merged into ONE message and written into
 * the running session; the tray shows it as being handed over. The agent's
 * confirmation (`confirm`) writes it into the conversation as a steer user
 * message, and the answer opens under it.
 *
 * A message the session refuses, or one written but never read when the run
 * ends (`settle`), goes back to the queue and starts the next turn. When the
 * write itself failed with an unknown outcome it stays in the tray, marked,
 * and is never sent again on its own.
 */
export const createLocalSteer = (options: LocalSteerOptions) => {
  const { context, contextKey, get, ipcSessionId, operationId } = options;
  let pending: PendingSteer | undefined;
  let stopped = false;

  /** Swap the taken messages back in for the merged one, at the head of the queue. */
  const giveBack = (steer: PendingSteer) => {
    get().removeQueuedMessage(contextKey, steer.messageId);
    get().requeueQueuedMessages(contextKey, steer.taken);
  };

  const markUnsupported = () => {
    stopped = true;
    get().updateOperationMetadata(operationId, { liveSteer: false, steerUnsupported: true });
  };

  const pump = async () => {
    if (stopped || pending || options.isWaitingForUser()) return;

    const queue = get().queuedMessages[contextKey] ?? [];
    const firstHeld = queue.findIndex(
      (message) => !canSteerClientRun(message) || !!message.localSteer,
    );
    const joinable = firstHeld === -1 ? queue.length : firstHeld;
    if (joinable === 0) return;

    const taken = get().drainQueuedMessages(contextKey, { limit: joinable });
    if (taken.length === 0) return;

    const merged = mergeQueuedMessages(taken);
    const steer: PendingSteer = {
      content: merged.content,
      messageId: crypto.randomUUID(),
      state: 'delivering',
      taken,
    };
    pending = steer;
    // One row stands for what was merged, so the tray shows exactly what goes in.
    get().requeueQueuedMessages(contextKey, [
      {
        content: merged.content,
        createdAt: taken[0].createdAt,
        editorData: merged.editorData,
        id: steer.messageId,
        interruptMode: 'soft',
        localSteer: 'delivering',
      },
    ]);

    let status: 'accepted' | 'rejected' | 'unsupported';
    try {
      ({ status } = await heterogeneousAgentService.steerSession({
        messageId: steer.messageId,
        prompt: merged.content,
        sessionId: ipcSessionId,
      }));
    } catch (error) {
      // It may or may not be in the session: never sent again on its own.
      console.error('[localSteer] steering the session failed:', error);
      get().updateQueuedMessage(contextKey, steer.messageId, { localSteer: 'unknown' });
      pending = undefined;
      stopped = true;
      return;
    }

    if (status === 'accepted') {
      steer.state = 'written';
      log('[%s] Steered %d messages as %s', operationId, taken.length, steer.messageId);
      return;
    }
    pending = undefined;
    giveBack(steer);
    if (status === 'unsupported') markUnsupported();
    // Refused: the session takes no input now, so the rest waits for the run end.
    else stopped = true;
  };

  const schedule = () => {
    pump().catch((error) => console.error('[localSteer] steer failed:', error));
  };

  const unsubscribe = options.subscribe(schedule);

  /**
   * The agent read a user message. When it is the one steered here, write it
   * into the conversation on the run's spine, so the next turn opens under it.
   *
   * @returns whether the event was this steer's confirmation
   */
  const confirm = async (data: SteerConfirmation): Promise<boolean> => {
    const steer = pending;
    if (!steer || steer.state !== 'written') return false;
    const matches = data.uuid
      ? data.uuid === steer.messageId
      : data.text !== undefined && data.text.trim() === steer.content.trim();
    if (!matches) return false;

    pending = undefined;
    const message = {
      agentId: context.agentId,
      content: steer.content,
      groupId: context.groupId ?? undefined,
      id: steer.messageId,
      metadata: { steer: true },
      parentId: options.spine.get(),
      role: 'user' as const,
      threadId: context.threadId ?? undefined,
      topicId: context.topicId ?? undefined,
    };
    get().internal_dispatchMessage(
      { id: message.id, type: 'createMessage', value: { ...message } },
      { operationId },
      { creationOrigin: 'client' },
    );
    get().removeQueuedMessage(contextKey, steer.messageId);
    options.spine.set(message.id);
    try {
      await messageService.createMessage(message);
      get().internal_confirmClientMessages([message.id]);
    } catch (error) {
      // The agent already answers it; keep the row on screen and let the run-end
      // refresh reconcile it.
      console.error('[localSteer] writing the steer message failed:', error);
    }
    schedule();
    return true;
  };

  /**
   * The run ended: stop steering. A message written but never read was not
   * taken by the agent, so it goes back to the queue for the next turn.
   */
  const settle = () => {
    stopped = true;
    unsubscribe();
    const steer = pending;
    pending = undefined;
    if (steer?.state === 'written') giveBack(steer);
  };

  schedule();
  return { confirm, pump: schedule, settle };
};

export type LocalSteer = ReturnType<typeof createLocalSteer>;

/**
 * Set up steering for a local heterogeneous run when the Follow-up behavior is
 * Steer. A runtime with no native steer is marked instead, so the tray says
 * its queue waits for the run end.
 */
export const startLocalSteer = (
  options: Omit<LocalSteerOptions, 'subscribe'> & {
    agentType: HeterogeneousAgentType | string;
    codexAppServer?: boolean;
  },
): LocalSteer | undefined => {
  if (getFollowUpMode() !== 'steer') return;

  const { contextKey, get, operationId } = options;
  if (!supportsLocalSteer(options.agentType, { codexAppServer: options.codexAppServer })) {
    get().updateOperationMetadata(operationId, { steerUnsupported: true });
    return;
  }

  get().updateOperationMetadata(operationId, { liveSteer: true });
  return createLocalSteer({
    ...options,
    subscribe: (listener) =>
      useChatStore.subscribe((state, prev) => {
        if (state.queuedMessages[contextKey] !== prev.queuedMessages[contextKey]) listener();
      }),
  });
};
