import type {
  QueryMessagesInput,
  QueryMessagesOptions,
  UpdateToolMessageInput,
} from '@lobechat/agent-runtime';
import { parse } from '@lobechat/conversation-flow';
import type { CreateMessageParams, UIChatMessage, UpdateMessageParams } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';

/**
 * In-memory conversation store for a locally executed agent run.
 *
 * The runtime re-reads the whole message list after every tool step
 * (`executors/tool.ts` calls `messages.query()` twice per batch) and does a
 * parent preflight on every `call_llm`. On the server those are local database
 * queries; for a run executing on a device they must NOT become network round
 * trips, or the latency saved by running tools locally is handed straight back.
 *
 * So this store — not the cloud — is the authority for the duration of a run.
 * Replication to the cloud is a separate, asynchronous concern; nothing here
 * blocks on it.
 *
 * Semantics deliberately mirror `MessageModel.query`, because the runtime's
 * rebuilt state has to be the same shape either way:
 *
 *   - An ABSENT scope filter means `IS NULL`, not "any". `matchTopic(undefined)`
 *     is `isNull(messages.topicId)` on the server, so a query without a
 *     `threadId` returns mainline messages only — never the whole topic
 *     including its threads.
 *   - Results are ordered by `(createdAt, id)` ascending.
 *   - `flatten` runs the same `@lobechat/conversation-flow` parser the server
 *     adapter uses, so grouped/tool rows collapse identically.
 */
export class LocalMessageStore {
  private readonly messages = new Map<string, UIChatMessage>();
  /** `clientId` → message id, for idempotent re-creation of one logical step. */
  private readonly byClientId = new Map<string, string>();
  /** Monotonic tiebreaker so messages created in the same millisecond keep insertion order. */
  private sequence = 0;
  private readonly sequenceById = new Map<string, number>();

  insert(params: CreateMessageParams, id: string = nanoid()): UIChatMessage {
    const existingId = params.clientId ? this.byClientId.get(params.clientId) : undefined;
    if (existingId) {
      const existing = this.messages.get(existingId);
      // Mirrors the server's idempotency conflict path: a redelivered step
      // returns the row already written rather than inserting a second one.
      if (existing) return existing;
    }

    const now = Date.now();
    // `clientId` is the idempotency key, not a message field; `sessionId` is the
    // deprecated predecessor of `agentId` and has no place on `UIChatMessage`.
    // Both are still forwarded to the cloud replica by the transport, which
    // sends the original params — the server resolves `sessionId` to an agent.
    const { clientId, sessionId: _sessionId, ...rest } = params;

    const message = {
      ...rest,
      content: params.content,
      createdAt: now,
      id,
      role: params.role,
      updatedAt: now,
    } as UIChatMessage;

    this.messages.set(id, message);
    this.sequenceById.set(id, this.sequence++);
    if (clientId) this.byClientId.set(clientId, id);

    return message;
  }

  get(id: string): UIChatMessage | undefined {
    return this.messages.get(id);
  }

  delete(id: string): void {
    this.messages.delete(id);
    this.sequenceById.delete(id);
    for (const [clientId, mappedId] of this.byClientId) {
      if (mappedId === id) this.byClientId.delete(clientId);
    }
  }

  update(id: string, params: Partial<UpdateMessageParams>): void {
    const existing = this.messages.get(id);
    if (!existing) return;
    this.messages.set(id, { ...existing, ...params, updatedAt: Date.now() } as UIChatMessage);
  }

  updatePluginState(id: string, state: Record<string, any>): void {
    const existing = this.messages.get(id);
    if (!existing) return;
    // Merged, not replaced — the server's `updatePluginState` patches the row's
    // existing state, and a tool that reports progress incrementally relies on
    // earlier keys surviving.
    this.messages.set(id, {
      ...existing,
      pluginState: { ...existing.pluginState, ...state },
      updatedAt: Date.now(),
    });
  }

  updateToolIntervention(id: string, intervention: Record<string, any>): void {
    const existing = this.messages.get(id);
    if (!existing) return;
    this.messages.set(id, {
      ...existing,
      pluginIntervention: intervention as UIChatMessage['pluginIntervention'],
      updatedAt: Date.now(),
    });
  }

  updateToolMessage(id: string, params: UpdateToolMessageInput): void {
    const existing = this.messages.get(id);
    if (!existing) return;

    const next: UIChatMessage = { ...existing, updatedAt: Date.now() };
    if (params.content !== undefined) next.content = params.content;
    if (params.metadata !== undefined) {
      next.metadata = { ...existing.metadata, ...params.metadata } as never;
    }
    if (params.pluginError !== undefined) next.pluginError = params.pluginError;
    if (params.pluginState !== undefined) {
      next.pluginState = { ...existing.pluginState, ...params.pluginState };
    }

    this.messages.set(id, next);
  }

  /**
   * The tool row already holding this call, scoped to the assistant message
   * that made it — `tool_call_id` is provider-supplied, so an unscoped match
   * can hit a reused id from an unrelated turn.
   */
  findToolMessageIdByToolCallId(toolCallId: string, parentMessageId: string): string | undefined {
    for (const message of this.messages.values()) {
      if (
        message.role === 'tool' &&
        message.parentId === parentMessageId &&
        message.tool_call_id === toolCallId
      ) {
        return message.id;
      }
    }
    return undefined;
  }

  query(params: QueryMessagesInput = {}, options: QueryMessagesOptions = {}): UIChatMessage[] {
    const { agentId, groupId, threadId, topicId } = params;

    const matches = [...this.messages.values()].filter((message) => {
      // Absent filter means IS NULL — see the class doc. Getting this wrong
      // silently mixes thread messages into a mainline query.
      if (!this.matchesScope(message.topicId, topicId)) return false;
      if (!this.matchesScope(message.threadId, threadId)) return false;

      // Group chat filters on groupId alone: members share the group but carry
      // different agentIds, so adding agentId here would drop every member row.
      if (groupId) return message.groupId === groupId;
      if (agentId && message.agentId !== agentId) return false;

      return true;
    });

    matches.sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return (this.sequenceById.get(a.id) ?? 0) - (this.sequenceById.get(b.id) ?? 0);
    });

    if (!options.flatten) return matches;

    const { flatList } = parse(matches as never);
    return flatList as unknown as UIChatMessage[];
  }

  /** Every message, insertion-ordered. Used to seed a run from prior history. */
  all(): UIChatMessage[] {
    return this.query({}, {});
  }

  /** Seed prior conversation history fetched once at run start. */
  hydrate(messages: UIChatMessage[]): void {
    for (const message of messages) {
      this.messages.set(message.id, message);
      this.sequenceById.set(message.id, this.sequence++);
    }
  }

  get size(): number {
    return this.messages.size;
  }

  private matchesScope(value: string | null | undefined, filter: string | undefined): boolean {
    return filter ? value === filter : value === null || value === undefined;
  }
}
