import type { WebhookEventData, WebhookEventType } from '@lobechat/types';

import type { LobeChatDatabase, Transaction } from './type';

/** Who an event belongs to: the row's owner and the space it was written in. */
export interface DatabaseEventScope {
  userId: string;
  workspaceId?: string | null;
}

export type DatabaseEventListener = <T extends WebhookEventType>(
  db: LobeChatDatabase,
  scope: DatabaseEventScope,
  type: T,
  data: WebhookEventData<T>,
) => void;

/** On `globalThis` so every bundled copy of this module shares one listener. */
const LISTENER_KEY = Symbol.for('lobehub.database.eventListener');
type ListenerHolder = typeof globalThis & { [LISTENER_KEY]?: DatabaseEventListener };

/**
 * The domain-event outlet of the data layer. Models announce the writes other
 * systems react to (a message or topic created, a task or goal changing status, a
 * notification created) here, at the one place every caller's write passes
 * through; the server registers the single listener that turns them into
 * developer webhooks. With no listener (tests, client DB) emitting is a no-op.
 */
export const setDatabaseEventListener = (listener: DatabaseEventListener | undefined) => {
  (globalThis as ListenerHolder)[LISTENER_KEY] = listener;
};

export const hasDatabaseEventListener = () => !!(globalThis as ListenerHolder)[LISTENER_KEY];

/** Never throws: an event consumer must not fail the write that produced the event. */
export const emitDatabaseEvent = <T extends WebhookEventType>(
  db: LobeChatDatabase | Transaction,
  scope: DatabaseEventScope,
  type: T,
  data: WebhookEventData<T>,
): void => {
  const listener = (globalThis as ListenerHolder)[LISTENER_KEY];
  if (!listener || !scope.userId) return;
  try {
    listener(db as LobeChatDatabase, scope, type, data);
  } catch (error) {
    console.error(`[database:events] listener failed for ${type}`, error);
  }
};
