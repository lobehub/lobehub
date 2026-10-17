import debug from 'debug';

import { messageService } from '@/services/message';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import type { ClientSubAgentBridgeRegistration } from './types';

const log = debug('lobe-store:client-subagent-bridge');

interface ParkMarkerPluginState {
  resumePending?: boolean;
  status?: string;
}

/**
 * Hydrate the parent's persisted message bucket from the server. After a
 * reload the renderer may hold only the child-context bucket (e.g. while
 * viewing / approving the child thread) — `dbMessagesMap` then has no row for
 * the parent's tool message at all, which must NOT be read as proof that the
 * parent settled. The read is the stored payload (no `projectToolPayloads`
 * reduction), so the deferred `pluginState` survives the round-trip. The
 * fetched rows ALSO land in the store via `replaceMessages`, so the resume
 * path re-enters with real history instead of an empty bucket. Returns the
 * tool row read straight from the fetched payload — authoritative even when
 * the store write is mocked away or races.
 */
const hydrateParentBucket = async (
  get: () => any,
  parentContext: ClientSubAgentBridgeRegistration['childContext'],
  toolMessageId: string,
): Promise<{ pluginState?: ParkMarkerPluginState } | undefined> => {
  if (!parentContext.topicId) return undefined;
  const messages = await messageService.getMessages({ ...parentContext, skipWorks: true });
  try {
    get().replaceMessages(messages, { context: parentContext });
  } catch (error) {
    // Store hydration is best-effort — the guard below reads the row from
    // the fetched payload, not from the store.
    log('bridge: failed to hydrate the parent bucket store for %s: %O', toolMessageId, error);
  }
  log(
    'bridge: hydrated the parent bucket for tool message %s (%d rows)',
    toolMessageId,
    messages.length,
  );
  return messages.find((m: { id?: string }) => m.id === toolMessageId);
};

/**
 * Durable park signal for the post-reload path: the parent operation is gone,
 * so the deferred placeholder's plugin state persisted on the tool row is the
 * only signal left. Two surviving shapes mean the parent never resumed:
 *
 * - `status: 'running'` — the deferred placeholder itself, the park (the
 *   pre-marker shape is retained so in-flight runs keep working).
 * - `status: 'completed' | 'error'` WITH `resumePending: true` (P1 round-15) —
 *   the bridge backfilled the child result but the re-entry failed or the
 *   renderer reloaded before it succeeded. The backfill used to overwrite
 *   `running`, leaving no park signal at all, so reconstruction rejected the
 *   bridge and the parent was stranded forever. The marker is written with the
 *   backfill and cleared only after re-entry succeeds.
 *
 * Anything else means the parent settled out-of-band and a resume would be a
 * phantom.
 *
 * P1 (round-19): a MISSING tool row is no longer trusted as a settled parent.
 * The reloaded renderer hydrates only the child-context bucket when the user
 * is viewing / approving the child thread, so the persisted parent bucket can
 * be absent from `dbMessagesMap` entirely. Interpreting that unloaded state as
 * "parent settled" made the bridge skip backfill/resume, release its barrier
 * slot and delete the persisted coordinates — permanently stranding the
 * parent. The bucket is hydrated from the server first; only a row that is
 * still absent (or a failed hydration) counts as not parked.
 */
export const isParentResumable = async (
  get: () => any,
  parentContext: ClientSubAgentBridgeRegistration['childContext'],
  toolMessageId: string,
): Promise<boolean> => {
  const chatKey = messageMapKey(parentContext);
  const readToolRow = (): { pluginState?: ParkMarkerPluginState } | undefined => {
    const messages: Array<{ id?: string; pluginState?: ParkMarkerPluginState }> =
      get().dbMessagesMap[chatKey] || [];
    return messages.find((m) => m.id === toolMessageId);
  };
  let toolRow = readToolRow();
  if (!toolRow) {
    try {
      toolRow = await hydrateParentBucket(get, parentContext, toolMessageId);
    } catch (error) {
      // An unreadable parent state must never green-light a phantom resume —
      // treat a failed hydration as not parked.
      log('bridge: failed to hydrate the parent bucket for %s: %O', toolMessageId, error);
      return false;
    }
  }
  const pluginState = toolRow?.pluginState;
  if (!pluginState) return false;
  if (pluginState.status === 'running') return true;
  return (
    (pluginState.status === 'completed' || pluginState.status === 'error') &&
    pluginState.resumePending === true
  );
};
