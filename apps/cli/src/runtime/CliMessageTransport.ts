import type {
  CreateAssistantMessageOptions,
  MessageTransport,
  QueryMessagesInput,
  QueryMessagesOptions,
  RuntimeMessageRef,
  UpdateToolMessageInput,
} from '@lobechat/agent-runtime';
import type { CreateMessageParams, UIChatMessage, UpdateMessageParams } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';

import { LocalMessageStore } from './LocalMessageStore';
import type { MessageWriteQueue } from './MessageWriteQueue';

const toRef = (message: UIChatMessage): RuntimeMessageRef => ({
  agentId: message.agentId,
  groupId: message.groupId,
  id: message.id,
  model: message.model,
  parentId: message.parentId,
  provider: message.provider,
  role: message.role,
  threadId: message.threadId,
  topicId: message.topicId,
});

export interface CliMessageTransportOptions {
  /** Omit to run with no cloud replica at all. */
  queue?: MessageWriteQueue;
  store?: LocalMessageStore;
}

/**
 * {@link MessageTransport} for an agent run executing on a device.
 *
 * Reads are answered from memory and writes return as soon as the local store
 * has them; cloud replication happens behind the run. This is the difference
 * that makes local execution worth doing — the server adapter's `query()` is a
 * database round trip, and the runtime issues one after every tool batch, so a
 * naive device transport that read back from the cloud would trade the dispatch
 * latency it just saved for read latency instead.
 *
 * Message ids are minted here rather than by the database. That is what lets a
 * create return without waiting: the id the executor anchors its follow-up
 * writes to is already known, and the same id is what the replica is
 * eventually written under, so a replay rewrites rather than duplicates.
 */
export class CliMessageTransport implements MessageTransport {
  readonly store: LocalMessageStore;
  private readonly queue?: MessageWriteQueue;

  constructor(options: CliMessageTransportOptions = {}) {
    this.store = options.store ?? new LocalMessageStore();
    this.queue = options.queue;
  }

  async createAssistantMessage(
    params: CreateMessageParams,
    options?: CreateAssistantMessageOptions,
  ): Promise<RuntimeMessageRef> {
    const withClientId = options?.idempotencyKey
      ? { ...params, clientId: options.idempotencyKey }
      : params;

    const before = this.store.size;
    const message = this.store.insert(withClientId, nanoid());

    // A redelivered step resolves to the row already stored, so the replica
    // must not be told to create it twice.
    if (this.store.size > before) {
      await this.queue?.enqueue({
        message: { ...withClientId, id: message.id },
        type: 'createMessage',
      });
    }

    return toRef(message);
  }

  async createToolMessage(params: CreateMessageParams): Promise<RuntimeMessageRef> {
    const message = this.store.insert(params, nanoid());
    await this.queue?.enqueue({ message: { ...params, id: message.id }, type: 'createMessage' });
    return toRef(message);
  }

  async deleteMessage(id: string): Promise<void> {
    this.store.delete(id);
    // Intentionally not replicated: `message.batchMutate` has no delete
    // operation, so a deletion cannot be expressed in the replay log. The rows
    // the runtime deletes are placeholders it created moments earlier in the
    // same run, so the replica converges as long as the create is dropped too —
    // which it is not yet. Tracked as the one known divergence; a delete
    // operation on the cloud procedure closes it.
  }

  async findById(id: string): Promise<RuntimeMessageRef | undefined> {
    const message = this.store.get(id);
    return message ? toRef(message) : undefined;
  }

  async findToolMessageIdByToolCallId(
    toolCallId: string,
    parentMessageId: string,
  ): Promise<string | undefined> {
    return this.store.findToolMessageIdByToolCallId(toolCallId, parentMessageId);
  }

  async query(
    params?: QueryMessagesInput,
    options?: QueryMessagesOptions,
  ): Promise<UIChatMessage[]> {
    return this.store.query(params, options);
  }

  async update(id: string, params: Partial<UpdateMessageParams>): Promise<void> {
    this.store.update(id, params);
    await this.queue?.enqueue({ id, type: 'updateMessage', value: params });
  }

  async updatePluginState(id: string, state: Record<string, any>): Promise<void> {
    this.store.updatePluginState(id, state);
    // The cloud's batch union has no plugin-state operation of its own; the
    // tool-message one carries the same column.
    await this.queue?.enqueue({ id, type: 'updateToolMessage', value: { pluginState: state } });
  }

  async updateToolIntervention(id: string, intervention: Record<string, any>): Promise<void> {
    this.store.updateToolIntervention(id, intervention);
    // Also not expressible in the batch union — intervention lives on the
    // plugin row. Local state is correct; the replica lags on approval status
    // until the cloud procedure grows an operation for it.
  }

  async updateToolMessage(id: string, params: UpdateToolMessageInput): Promise<void> {
    this.store.updateToolMessage(id, params);
    await this.queue?.enqueue({ id, type: 'updateToolMessage', value: params });
  }
}
