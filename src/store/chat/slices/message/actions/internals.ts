import { parse } from '@lobechat/conversation-flow';
import { type TraceEventPayloads } from '@lobechat/types';
import debug from 'debug';
import isEqual from 'fast-deep-equal';

import { traceService } from '@/services/trace';
import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';

import { displayMessageSelectors } from '../../../selectors';
import { messageMapKey } from '../../../utils/messageMapKey';
import { type MessageDispatch } from '../reducer';
import { messagesReducer } from '../reducer';

const log = debug('lobe-store:message-internals');

/**
 * Internal core methods that serve as building blocks for other actions
 */

type Setter = StoreSetter<ChatStore>;
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
    context?: { operationId?: string },
  ): void => {
    // Get full conversation context (including scope) from operation or global state
    const ctx = this.#get().internal_getConversationContext(context);
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

    const nextDbMap = { ...this.#get().dbMessagesMap, [messagesKey]: updatedRawMessages };

    if (isEqual(nextDbMap, this.#get().dbMessagesMap)) return;

    // parse to get display messages
    const { flatList } = parse(updatedRawMessages);
    const nextDisplayMap = { ...this.#get().messagesMap, [messagesKey]: flatList };

    this.#set({ dbMessagesMap: nextDbMap, messagesMap: nextDisplayMap }, false, {
      payload,
      type: `dispatchMessage/${payload.type}`,
    });
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
