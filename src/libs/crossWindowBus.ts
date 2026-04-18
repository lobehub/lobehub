/**
 * Cross-window sync bus — thin wrapper over BroadcastChannel.
 *
 * Used to notify sibling windows (e.g. Electron main SPA ⇄ topic popup SPA)
 * that chat data has changed so they can revalidate their SWR caches.
 *
 * Data itself flows through the backend DB + SWR; this channel only carries
 * lightweight mutation signals — never message content.
 */

const CHANNEL_NAME = 'lobechat:sync';

export interface ChatSyncScope {
  agentId?: string;
  groupId?: string;
  topicId?: string;
}

type ChatSyncEventType = 'chat.messages-mutated' | 'chat.topics-mutated';

interface ChatSyncEvent {
  scope: ChatSyncScope;
  source: string;
  type: ChatSyncEventType;
}

export interface ChatSyncHandlers {
  onMessagesMutation?: (scope: ChatSyncScope) => void;
  onTopicsMutation?: (scope: ChatSyncScope) => void;
}

// Stable per-window identifier for telemetry / debugging. BroadcastChannel
// itself does not echo messages to the sender window, so this is not used
// for echo suppression — it's kept for logs and future tracing.
const WINDOW_ID = `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

let channel: BroadcastChannel | null | undefined;

function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    channel = null;
    return null;
  }
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    channel = null;
  }
  return channel;
}

// Module-level suppression flag. When a bus listener triggers a local
// revalidation, it calls the same refresh action that would normally
// broadcast — guard against the echo by wrapping with suppressBroadcast().
let suppressDepth = 0;

export const isBroadcastSuppressed = (): boolean => suppressDepth > 0;

export const suppressBroadcast = async <T>(fn: () => Promise<T> | T): Promise<T> => {
  suppressDepth += 1;
  try {
    return await fn();
  } finally {
    suppressDepth -= 1;
  }
};

function post(type: ChatSyncEventType, scope: ChatSyncScope): void {
  if (isBroadcastSuppressed()) return;
  const ch = getChannel();
  if (!ch) return;
  try {
    ch.postMessage({ scope, source: WINDOW_ID, type } satisfies ChatSyncEvent);
  } catch {
    // Ignore post failures — remote windows will naturally re-sync on next
    // user action. Not worth surfacing transient BroadcastChannel errors.
  }
}

export const postMessagesMutation = (scope: ChatSyncScope): void => {
  post('chat.messages-mutated', scope);
};

export const postTopicsMutation = (scope: ChatSyncScope): void => {
  post('chat.topics-mutated', scope);
};

export const subscribeChatSync = (handlers: ChatSyncHandlers): (() => void) => {
  const ch = getChannel();
  if (!ch) return () => {};

  const listener = (ev: MessageEvent<ChatSyncEvent>) => {
    const data = ev.data;
    if (!data || typeof data !== 'object' || !data.type) return;

    switch (data.type) {
      case 'chat.messages-mutated': {
        handlers.onMessagesMutation?.(data.scope);
        break;
      }
      case 'chat.topics-mutated': {
        handlers.onTopicsMutation?.(data.scope);
        break;
      }
      // No default
    }
  };

  ch.addEventListener('message', listener);
  return () => ch.removeEventListener('message', listener);
};
