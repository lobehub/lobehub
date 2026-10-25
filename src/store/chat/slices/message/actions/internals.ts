import { type ConversationContext, type TraceEventPayloads } from '@lobechat/types';
import debug from 'debug';
import isEqual from 'fast-deep-equal';

import { traceService } from '@/services/trace';
import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';

import { displayMessageSelectors } from '../../../selectors';
import { messageMapKey } from '../../../utils/messageMapKey';
import { type MessageDispatch } from '../reducer';
import { messagesReducer } from '../reducer';
import { getMessageTranscript } from '../transcript';
import { reconcileAssistantToolLinks } from '../utils/reconcileTools';

const log = debug('lobe-store:message-internals');

/**
 * Internal core methods that serve as building blocks for other actions
 */

type Setter = StoreSetter<ChatStore>;
type MessageDispatchContext = NonNullable<
  Parameters<ChatStore['internal_getConversationContext']>[0]
> & {
  conversationContext?: ConversationContext;
};

export const messageInternals = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new MessageInternalsActionImpl(set, get, _api);

export class MessageInternalsActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  internal_dispatchMessage = (
    payload: MessageDispatch,
    context?: MessageDispatchContext,
    /**
     * Where a `createMessage` row came from. Only a client-created row can be
     * missing from a read that predates its server persistence; a server row
     * (e.g. a gateway `stream_start` shell) is authoritative from the start.
     * Defaults to `server` so an unlabelled insert is never preserved.
     */
    options?: { creationOrigin?: 'client' | 'server' },
  ): void => {
    // Get full conversation context (including scope) from operation or global state
    const ctx =
      context?.conversationContext ?? this.#get().internal_getConversationContext(context);
    log(
      '[internal_dispatchMessage] context: agentId=%s, topicId=%s, threadId=%s, scope=%s',
      ctx.agentId,
      ctx.topicId,
      ctx.threadId,
      ctx.scope,
    );

    const messagesKey = messageMapKey(ctx);

    // Get raw messages from dbMessagesMap and apply reducer
    const rawMessages = this.#get().dbMessagesMap[messagesKey] || [];
    const updatedRawMessages = messagesReducer(rawMessages, payload);

    // Re-link any tool row whose parent assistant lost its tools[] entry — an
    // optimistic updateMessage{tools} on the wrong/old assistant during a step
    // boundary can drop the link while the tool row survives, orphaning the
    // tool bubble. Reconcile on the RAW array so the SoT stays consistent (see
    // reconcileAssistantToolLinks).
    const reconciled = reconcileAssistantToolLinks(updatedRawMessages);

    if (isEqual(reconciled, rawMessages)) return;

    log('[internal_dispatchMessage] %s | key=%s', payload.type, messagesKey);
    const transcript = getMessageTranscript(this.#set, this.#get);
    transcript.commit(
      ctx,
      reconciled,
      true,
      payload.type === 'createMessage' && options?.creationOrigin === 'client'
        ? payload.id
        : undefined,
    );

    // A locally deleted client row can no longer be preserved. Its dispatch
    // removes it before any server replacement can observe the removal.
    if (payload.type === 'deleteMessage') transcript.forgetClientRows([payload.id]);
    else if (payload.type === 'deleteMessages') transcript.forgetClientRows(payload.ids);
    transcript.settle(ctx);
  };

  /** Insert a row this client created, so a stale read cannot drop it before it persists. */
  internal_createClientMessage = (
    id: string,
    value: Extract<MessageDispatch, { type: 'createMessage' }>['value'],
    context?: MessageDispatchContext,
  ): void => {
    this.#get().internal_dispatchMessage({ id, type: 'createMessage', value }, context, {
      creationOrigin: 'client',
    });
  };

  /** The server persisted these client-created rows (a quiet write, no snapshot back). */
  internal_confirmClientMessages = (ids: string[]): void => {
    if (ids.length === 0) return;
    getMessageTranscript(this.#set, this.#get).confirmPersistedRows(ids);
  };

  internal_traceMessage = async (id: string, payload: TraceEventPayloads): Promise<void> => {
    // tracing the diff of update
    const message = displayMessageSelectors.getDisplayMessageById(id)(this.#get());
    if (!message) return;

    const traceId = message?.traceId;
    const observationId = message?.observationId;

    if (traceId && message?.role === 'assistant') {
      traceService
        .traceEvent({ content: message.content, observationId, traceId, ...payload })
        .catch();
    }
  };
}

export type MessageInternalsAction = Pick<
  MessageInternalsActionImpl,
  keyof MessageInternalsActionImpl
>;
