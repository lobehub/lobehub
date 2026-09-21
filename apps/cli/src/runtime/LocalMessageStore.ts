import type {
  QueryMessagesInput,
  QueryMessagesOptions,
  UpdateToolMessageInput,
} from '@lobechat/agent-runtime';
import { parse } from '@lobechat/conversation-flow';
import type { CreateMessageParams, UIChatMessage, UpdateMessageParams } from '@lobechat/types';
import { merge, nanoid } from '@lobechat/utils';

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
  /**
   * `threadId` → the ids a thread read must include alongside its own rows.
   *
   * The server derives these by resolving the thread's `sourceMessageId`
   * against the `threads` table; a device has no such table, so the host
   * registers them when it hydrates. Unregistered, a thread read falls back to
   * exact `threadId` matching — which is also the server's own fallback when a
   * thread has no source message.
   */
  private readonly threadParents = new Map<string, Set<string>>();

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

    const { metadata, ...rest } = params;
    const next = { ...existing, ...rest, updatedAt: Date.now() } as UIChatMessage;

    // `metadata` is patched, not replaced. A `call_llm` step stamps provenance
    // (operationId and friends) up front and finalizes with a second, partial
    // metadata write; a shallow spread would drop everything the first write
    // put there. The canonical model deep-merges here, so the local read-back
    // has to as well or device-hosted state quietly loses fields the cloud
    // replica still has.
    if (metadata !== undefined) {
      next.metadata = merge(existing.metadata ?? {}, metadata) as UIChatMessage['metadata'];
    }

    this.messages.set(id, next);
  }

  /**
   * Declare the messages a thread read must return alongside the thread's own
   * rows — the thread's source message and its ancestors.
   */
  registerThreadParents(threadId: string, parentMessageIds: string[]): void {
    this.threadParents.set(threadId, new Set(parentMessageIds));
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
    const all = [...this.messages.values()];

    // Three branches, mirroring `MessageModel.query`. They are not variations
    // on one predicate — each scopes differently, and collapsing them is how a
    // local store starts returning a different conversation than the server.
    let matches: UIChatMessage[];

    if (threadId) {
      // A complete thread is its own rows PLUS the parent messages it hangs
      // off; a thread read that returned only the former would start the model
      // mid-conversation. Scoped by topic when one is known, because a topic
      // thread can legitimately carry replies from delegated agents that the
      // parent-agent filter would drop.
      const parents = this.threadParents.get(threadId) ?? new Set<string>();
      matches = all.filter((message) => {
        if (message.threadId !== threadId && !parents.has(message.id)) return false;
        return topicId ? message.topicId === topicId : !agentId || message.agentId === agentId;
      });
    } else if (groupId) {
      // Group chat scopes on groupId alone: members share the group but carry
      // different agentIds, so adding agentId would drop every member row.
      matches = all.filter(
        (message) =>
          message.groupId === groupId &&
          this.matchesScope(message.topicId, topicId) &&
          this.matchesScope(message.threadId, threadId),
      );
    } else {
      matches = all.filter((message) => {
        // A concrete topic IS the conversation boundary and may hold messages
        // from several agents — `callAgent` replies among them. Only an inbox
        // read, which has no topic, still needs agent scope. Applying agentId
        // universally silently deletes delegated-agent turns from the model's
        // context on a device-hosted run.
        const inConversation = topicId
          ? message.topicId === topicId
          : (!agentId || message.agentId === agentId) && message.topicId == null;

        return (
          inConversation &&
          this.matchesScope(message.groupId, groupId) &&
          this.matchesScope(message.threadId, threadId)
        );
      });
    }

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
