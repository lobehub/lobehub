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

/** How often a message waiting for the runtime to come up checks again. */
const STARTUP_RETRY_MS = 500;

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
  agentType === 'antigravity' ||
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
  /**
   * Whether the agent's runtime is up (it has streamed output). Before that the
   * session has no way in yet, so a message waits instead of being refused.
   */
  isReady: () => boolean;
  /** Whether the run waits for the user (a pending question or approval); nothing is steered then. */
  isWaitingForUser: () => boolean;
  operationId: string;
  /**
   * The run's write-behind rows: the steer message's parent can still be only
   * enqueued, so its write waits for it (`ensureParentPersisted`), and a failed
   * write is parked for the in-order replay (`add`) like the run's own rows.
   */
  rows: {
    add: (messageId: string, message: any) => void;
    ensureParentPersisted: (parentId?: string) => Promise<void>;
  };
  /** The message the next steer user message parents off (the run's spine), and its update. */
  spine: { get: () => string; set: (id: string) => void };
  subscribe: (listener: () => void) => () => void;
}

interface PendingSteer {
  content: string;
  /**
   * The text the agent received (Pi reports a read message by its text, which
   * the transport can expand with context); `content` when not reported.
   */
  deliveredText?: string;
  messageId: string;
  /** The run ended while the write was still unanswered: its row was marked uncertain. */
  settledInFlight?: boolean;
  /**
   * `delivering` until the IPC answers; `written` once accepted, until the
   * agent reads it; `unknown` when the write failed and it may still arrive.
   */
  state: 'delivering' | 'unknown' | 'written';
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
  let pumping = false;
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

  let startupTimer: ReturnType<typeof setTimeout> | undefined;

  const pump = async () => {
    if (stopped || pending || pumping || options.isWaitingForUser()) return;
    // Queue chosen meanwhile: what waits now goes once the run ends.
    if (getFollowUpMode() !== 'steer') return;
    if (!options.isReady()) {
      if (hasJoinable()) startupTimer ??= setTimeout(retryAfterStartup, STARTUP_RETRY_MS);
      return;
    }
    // Taking from the queue notifies its subscribers, this pump among them.
    pumping = true;
    let again = false;
    try {
      again = await pumpOnce();
    } finally {
      pumping = false;
    }
    // Read before its write was answered: what queued meanwhile can go now.
    if (again) schedule();
  };

  /** How many queued messages, from the head, can join a running turn. */
  const joinableCount = () => {
    const queue = get().queuedMessages[contextKey] ?? [];
    const firstHeld = queue.findIndex(
      (message) => !canSteerClientRun(message) || !!message.localSteer,
    );
    return firstHeld === -1 ? queue.length : firstHeld;
  };
  const hasJoinable = () => joinableCount() > 0;

  const retryAfterStartup = () => {
    startupTimer = undefined;
    schedule();
  };

  /** @returns whether the steer was read before its write was answered, so the pump runs again */
  const pumpOnce = async (): Promise<boolean> => {
    const joinable = joinableCount();
    if (joinable === 0) return false;

    const taken = get().drainQueuedMessages(contextKey, { limit: joinable });
    if (taken.length === 0) return false;

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
      ({ deliveredText: steer.deliveredText, status } =
        await heterogeneousAgentService.steerSession({
          messageId: steer.messageId,
          prompt: merged.content,
          sessionId: ipcSessionId,
        }));
    } catch (error) {
      // The run ended first: the row is already marked uncertain and stays so.
      if (steer.settledInFlight) return false;
      // Read already (`confirm` ran first): it landed.
      if (pending !== steer) return true;
      // It may or may not be in the session: never sent again on its own, but
      // kept so the agent reporting it read still writes it in.
      console.error('[localSteer] steering the session failed:', error);
      get().updateQueuedMessage(contextKey, steer.messageId, { localSteer: 'unknown' });
      steer.state = 'unknown';
      stopped = true;
      return false;
    }

    if (steer.settledInFlight) {
      // A definite refusal wrote nothing: the messages run as the next turn.
      if (status !== 'accepted') giveBack(steer);
      return false;
    }
    // The agent can report reading it before the write is answered (Codex).
    if (pending !== steer) return true;
    if (status === 'accepted') {
      steer.state = 'written';
      log('[%s] Steered %d messages as %s', operationId, taken.length, steer.messageId);
      return false;
    }
    // Refused: the session takes no input now, so it and the rest wait for the
    // run end. Stop first: restoring the queue notifies this pump again.
    pending = undefined;
    stopped = true;
    if (status === 'unsupported') markUnsupported();
    giveBack(steer);
    return false;
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
    if (!steer) return false;
    const matches = data.uuid
      ? data.uuid === steer.messageId
      : data.text !== undefined &&
        data.text.trim() === (steer.deliveredText ?? steer.content).trim();
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
    // The agent answers it under this message whatever the write does next.
    options.spine.set(message.id);
    try {
      await options.rows.ensureParentPersisted(message.parentId);
      await messageService.createMessage(message);
      get().internal_confirmClientMessages([message.id]);
    } catch (error) {
      // Parked for the run's in-order replay: the answer rows behind it wait too.
      console.error('[localSteer] writing the steer message failed:', error);
      options.rows.add(message.id, message);
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
    if (startupTimer) clearTimeout(startupTimer);
    unsubscribe();
    const steer = pending;
    pending = undefined;
    if (steer?.state === 'written') giveBack(steer);
    // Still being written: it may have reached the agent, so it is never sent
    // again on its own unless the write comes back refused.
    if (steer?.state === 'delivering') {
      steer.settledInFlight = true;
      get().updateQueuedMessage(contextKey, steer.messageId, { localSteer: 'unknown' });
    }
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
  const mode = getFollowUpMode();

  const { contextKey, get, operationId } = options;
  if (!supportsLocalSteer(options.agentType, { codexAppServer: options.codexAppServer })) {
    get().updateOperationMetadata(operationId, { steerUnsupported: true });
    return;
  }
  // Claude Code keeps its input open in every mode, but a run takes messages
  // mid-run only when started in Steer (the SDK session replays what it reads
  // only then, which is how a steer is confirmed), so a run started in Queue
  // mode stays queued. Codex app-server and Pi can take one at any point: their
  // pump checks the mode before each delivery, so switching to Steer applies.
  if (options.agentType === 'claude-code' && mode !== 'steer') return;

  get().updateOperationMetadata(operationId, { liveSteer: true });
  return createLocalSteer({
    ...options,
    subscribe: (listener) =>
      useChatStore.subscribe((state, prev) => {
        if (state.queuedMessages[contextKey] !== prev.queuedMessages[contextKey]) listener();
      }),
  });
};
