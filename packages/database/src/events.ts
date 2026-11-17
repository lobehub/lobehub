import { AsyncLocalStorage } from 'node:async_hooks';

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
 * notification created) here, from the model methods those writes go through; the
 * server registers the single listener that turns them into developer webhooks.
 * With no listener (tests, client DB) emitting is a no-op.
 *
 * Events raised inside `db.transaction()` wait for it: they are dispatched once the
 * outermost transaction commits and dropped when it rolls back, so a consumer never
 * hears about a write that did not happen or is not visible yet. This needs a
 * database handle passed through {@link instrumentDatabaseEvents}; the server's is.
 */
export const setDatabaseEventListener = (listener: DatabaseEventListener | undefined) => {
  (globalThis as ListenerHolder)[LISTENER_KEY] = listener;
};

export const hasDatabaseEventListener = () => !!(globalThis as ListenerHolder)[LISTENER_KEY];

/** Events waiting for the transaction they were raised in. */
const pendingInTransaction = new AsyncLocalStorage<(() => void)[]>();
const INSTRUMENTED = Symbol.for('lobehub.database.eventsInstrumented');

/**
 * Make `db.transaction()` hold back the events raised inside it until it commits.
 * Idempotent; leaves handles without a `transaction` method (test stubs) alone.
 */
export const instrumentDatabaseEvents = <T>(db: T): T => {
  const target = db as unknown as {
    [INSTRUMENTED]?: boolean;
    transaction?: (...args: any[]) => Promise<unknown>;
  };
  if (!target || typeof target.transaction !== 'function' || target[INSTRUMENTED]) return db;

  const original = target.transaction.bind(db);
  target.transaction = async (...args: any[]) => {
    // A transaction opened inside another one is a savepoint: the outer one decides.
    if (pendingInTransaction.getStore()) return original(...args);

    const pending: (() => void)[] = [];
    const result = await pendingInTransaction.run(pending, () => original(...args));
    for (const dispatch of pending) dispatch();
    return result;
  };
  target[INSTRUMENTED] = true;
  return db;
};

/** Never throws: an event consumer must not fail the write that produced the event. */
export const emitDatabaseEvent = <T extends WebhookEventType>(
  db: LobeChatDatabase | Transaction,
  scope: DatabaseEventScope,
  type: T,
  data: WebhookEventData<T>,
): void => {
  const listener = (globalThis as ListenerHolder)[LISTENER_KEY];
  if (!listener || !scope.userId) return;
  const dispatch = () => {
    try {
      listener(db as LobeChatDatabase, scope, type, data);
    } catch (error) {
      console.error(`[database:events] listener failed for ${type}`, error);
    }
  };
  const pending = pendingInTransaction.getStore();
  if (pending) pending.push(dispatch);
  else dispatch();
};
