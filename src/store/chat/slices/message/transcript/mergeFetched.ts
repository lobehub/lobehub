import { type UIChatMessage } from '@lobechat/types';

import { reconcileIntervention } from '@/store/chat/utils/interventionSync';
import {
  isLocalOnlyMessage,
  mergeLocalMessagesByCreatedAt,
} from '@/store/chat/utils/localMessages';

/** What a head read can legitimately be missing, captured when it was issued. */
export interface HeadRequestBoundary {
  /**
   * Client-created rows this read cannot treat as server-authoritative: those
   * still unconfirmed when it was issued, plus those created while it was in
   * flight. A snapshot that omits one predates its persistence.
   *
   * Rows painted from storage hydration and rows applied from a server
   * response are deliberately absent: the server already knows them, so a
   * snapshot that omits one is authoritative (e.g. a remote delete).
   */
  unconfirmedClientIds: ReadonlySet<string>;
}

/**
 * Merge an idle head fetch into the shown transcript.
 *
 * A fetch can be issued before a send persists its rows and resolve while
 * `sendMessage` is still waiting for the server. That window is not a running
 * agent runtime, so the optimistic user and assistant rows must be kept
 * explicitly until the server returns them; otherwise the just-sent message
 * vanishes until the run settles and refetches.
 *
 * The send operation ends as soon as the runtime takes over, while a read that
 * was already in flight can still resolve afterwards with the pre-send
 * snapshot. `boundary` covers both orderings: a client row created after the
 * read was issued, and one created before it but not yet confirmed by a
 * server snapshot.
 */
export const mergeFetchedMessagesWithLocalState = (
  fetchedMessages: UIChatMessage[],
  localMessages: UIChatMessage[],
  activeVoiceMessageIds: ReadonlySet<string>,
  creatingMessageIds: ReadonlySet<string>,
  boundary?: HeadRequestBoundary,
): UIChatMessage[] => {
  if (localMessages.length === 0) return fetchedMessages;

  const localById = new Map(localMessages.map((message) => [message.id, message]));
  const fetchedIds = new Set(fetchedMessages.map((message) => message.id));
  let changed = false;

  const mergedMessages = fetchedMessages.map((message) => {
    const localMessage = localById.get(message.id);

    if (!localMessage) return message;
    const resolved = reconcileIntervention(localMessage, message);
    if (resolved) return resolved;
    // Once the server returns this id, its persisted row replaces the local-only preview.
    if (isLocalOnlyMessage(localMessage)) return message;
    if (localMessage.updatedAt <= message.updatedAt) return message;

    changed = true;
    return localMessage;
  });

  const missingLocalMessages = localMessages.filter(
    (message) =>
      !fetchedIds.has(message.id) &&
      ((isLocalOnlyMessage(message) && activeVoiceMessageIds.has(message.id)) ||
        creatingMessageIds.has(message.id) ||
        // Client-created and not yet confirmed by a server snapshot: this read
        // predates its persistence. Hydrated and server-applied rows are never
        // in this set, so an authoritative omission still removes them.
        !!boundary?.unconfirmedClientIds.has(message.id)),
  );

  if (missingLocalMessages.length === 0) return changed ? mergedMessages : fetchedMessages;

  return mergeLocalMessagesByCreatedAt(mergedMessages, missingLocalMessages);
};
