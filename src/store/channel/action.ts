import { isDesktop } from '@lobechat/const';
import type { ChannelPublicThread, ChannelStatus, ChannelThreadStatus } from '@lobechat/types';

import { cacheScope } from '@/libs/replica';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { channelKeys } from '@/libs/swr/keys';
import {
  type ChannelAgentSelection,
  channelService,
  type ChannelViewParams,
  type ChannelWakeConfig,
} from '@/services/channel';
import { getElectronStoreState } from '@/store/electron';

import {
  addOutgoing,
  type ChannelOutbox,
  channelOutboxKey,
  type ChannelOutgoingMessage,
  findOutgoing,
  patchOutgoing,
  removeOutgoing,
} from './outbox';
import { channelOutboxStorage } from './outboxStorage';
import { ChannelPrivateAction } from './privateAction';
import { channelThreadEntityId } from './projection';
import { channelSelectors } from './selectors';
import { initialState, useChannelStore } from './store';

/**
 * Gateway push is not delivered yet, so polling is the only refresh: views with work in
 * progress (and the list while a listed reply is) refresh every few seconds, idle ones once a
 * minute.
 */
export const CHANNEL_ACTIVE_REFRESH_MS = 3000;
export const CHANNEL_IDLE_REFRESH_MS = 60_000;

type ChannelSendInput = Parameters<typeof channelService.send>[0];

/** What the composer hands over; the outbox adds the request key, time and status. */
export type ChannelQueuedSendInput = Pick<
  ChannelOutgoingMessage,
  'attachments' | 'channelId' | 'content' | 'fileIds' | 'mentions' | 'replyTo' | 'replyToId'
> & { threadId?: string | null };

class ChannelActionImpl {
  readonly #private = new ChannelPrivateAction(useChannelStore.setState, useChannelStore.getState);
  useFetchUserCandidates = (channelId: string | undefined, search: string) =>
    useClientDataSWR(channelKeys.userCandidates(channelId, search), () =>
      channelService.userCandidates(channelId, search),
    );
  useFetchList = () => {
    const pending = useChannelStore(channelSelectors.listHasPendingWork);
    return this.#private.list.useSync(
      {},
      { refreshInterval: pending ? CHANNEL_ACTIVE_REFRESH_MS : CHANNEL_IDLE_REFRESH_MS },
    );
  };
  useFetchDetail = (params: ChannelViewParams | null) => {
    // Subscribe to the replica, not just SWR's last response: sending a message
    // updates this view imperatively and must shorten an already scheduled idle poll.
    const pending = useChannelStore(channelSelectors.hasPendingWork(params));
    return this.#private.detail.useSync(params, {
      refreshInterval: pending ? CHANNEL_ACTIVE_REFRESH_MS : CHANNEL_IDLE_REFRESH_MS,
    });
  };
  refreshList = () => this.#private.list.fetch({}, { fresh: true });
  refreshDetail = (params: ChannelViewParams) =>
    this.#private.detail.fetch(params, { fresh: true });
  /**
   * Refresh after a write that already committed. A failed refresh must not read as a failed
   * write, or retrying repeats it; the periodic sync catches up instead.
   */
  #refreshAfterWrite = async (refresh: () => Promise<unknown>) => {
    try {
      await refresh();
    } catch (error) {
      console.error('Failed to refresh Channels after a write', error);
    }
  };
  create = async (input: Parameters<typeof channelService.create>[0]) => {
    const result = await channelService.create(input);
    await this.#refreshAfterWrite(this.refreshList);
    return result.data.channel.id;
  };
  /** Inviting into a direct conversation starts a new group; the conversation stays as it is. */
  createGroupFromDirect = async (
    input: Parameters<typeof channelService.createGroupFromDirect>[0],
  ) => {
    const result = await channelService.createGroupFromDirect(input);
    await this.#refreshAfterWrite(this.refreshList);
    return result.data.channel.id;
  };
  /**
   * Marks the main channel read up to `sequence`. The listed unread and mention counts drop at
   * once, so a conversation row does not keep its badges until the next list poll; a failed write
   * restores them.
   *
   * Mentions are counted from the same read position as `unreadCount`, so a read that reaches the
   * known `sequence` consumes all of them. A partial read cannot be split client-side without the
   * per-message mention data, so the cached count stays until the next list poll recomputes it.
   */
  markRead = (channelId: string, sequence: number) =>
    this.#private.entity.optimistic(
      channelId,
      (channel) => ({
        ...channel,
        mentionCount: channel.sequence <= sequence ? 0 : channel.mentionCount,
        unreadCount: Math.min(channel.unreadCount ?? 0, Math.max(0, channel.sequence - sequence)),
      }),
      () => channelService.markRead(channelId, sequence),
    );
  /**
   * The caller's direct Channel with an Agent, opening it for an Agent that predates direct
   * Channels. Undefined when the Agent cannot answer in a Channel.
   */
  openDirect = async (agentId: string) => {
    const existing = channelSelectors.directByAgent(agentId)(useChannelStore.getState());
    if (existing) return existing.id;
    // On desktop, name this machine so a direct Channel to a local Agent can run here.
    const localDeviceId = isDesktop
      ? await getElectronStoreState().resolveGatewayDeviceId()
      : undefined;
    const channelId = await channelService.openDirect({ agentId, localDeviceId });
    if (channelId) await this.#refreshAfterWrite(this.refreshList);
    return channelId ?? undefined;
  };
  remove = async (channelId: string) => {
    const scope = cacheScope.get();
    // Optimistically hide the row; failure restores it. Keep the open conversation
    // until success, then purge every thread/page (including persisted copies).
    await this.#private.list.optimistic(
      'all',
      (items) => items?.filter((channel) => channel.id !== channelId),
      () => channelService.remove(channelId),
    );
    this.#private.entity.remove(channelId, { scope });
  };
  removeThread = async (channelId: string, threadId: string) => {
    const scope = cacheScope.get();
    // Optimistically hide sidebar references, retaining the open view until confirmed.
    const tokens = this.#private.detail.beginEntityOptimistic(
      channelThreadEntityId(channelId, threadId),
      () => undefined,
    );
    try {
      await channelService.removeThread(channelId, threadId);
      for (const token of tokens) token.commit();
      this.#private.removeThread(channelId, threadId, scope);
    } catch (error) {
      for (const token of tokens) token.rollback();
      throw error;
    }
  };
  /**
   * Archive keeps the channel readable but closes it; the sidebar and the open view switch
   * before the server confirms, and a failure switches them back.
   */
  setArchived = async (channelId: string, archived: boolean) => {
    const status: ChannelStatus = archived ? 'archived' : 'active';
    await this.#private.entity.optimistic(
      channelId,
      (channel) => ({ ...channel, status }),
      () => (archived ? channelService.archive(channelId) : channelService.unarchive(channelId)),
    );
    // Archiving stopped every reply in progress.
    if (archived) await this.#refreshAfterWrite(() => this.refreshDetail({ channelId }));
  };
  setThreadArchived = async (channelId: string, threadId: string, archived: boolean) => {
    const status: ChannelThreadStatus = archived ? 'archived' : 'active';
    const tokens = this.#private.detail.beginEntityOptimistic<ChannelPublicThread>(
      channelThreadEntityId(channelId, threadId),
      (thread) => ({ ...thread, status }),
    );
    try {
      await (archived
        ? channelService.archiveThread(channelId, threadId)
        : channelService.unarchiveThread(channelId, threadId));
      for (const token of tokens) token.commit();
    } catch (error) {
      for (const token of tokens) token.rollback();
      throw error;
    }
    if (archived) await this.#refreshAfterWrite(() => this.refreshDetail({ channelId, threadId }));
  };
  /** Threads restored from the recycle bin; call before revalidating their views. */
  forgetThreadRemovals = (threadIds: string[]) => this.#private.forgetThreadRemovals(threadIds);
  /** The sidebar row and the open header show the new name before the server confirms. */
  rename = async (channelId: string, title: string) => {
    await this.#private.entity.optimistic(
      channelId,
      (channel) => ({ ...channel, title }),
      () => channelService.rename(channelId, title),
    );
  };
  useFetchAgentEnvironment = (channelId: string, memberId: string) =>
    useClientDataSWR(channelKeys.agentEnvironment(channelId, memberId), () =>
      channelService.agentEnvironment(channelId, memberId),
    );
  useFetchWakeConfig = (channelId: string | null) =>
    useClientDataSWR(channelId ? channelKeys.wakeConfig(channelId) : null, () =>
      channelService.wakeConfig(channelId!),
    );
  updateWakeConfig = async (channelId: string, wake: ChannelWakeConfig) => {
    await channelService.updateWakeConfig(channelId, wake);
    await this.#refreshAfterWrite(() => mutate(channelKeys.wakeConfig(channelId)));
  };
  updateAgentEnvironment = async (
    channelId: string,
    memberId: string,
    environment: Pick<ChannelAgentSelection, 'deviceId' | 'workingDirectory'>,
  ) => {
    await channelService.updateAgentEnvironment(channelId, memberId, environment);
    // Blocked replies may resume on the new device or directory.
    await this.#refreshAfterWrite(() =>
      Promise.all([
        mutate(channelKeys.agentEnvironment(channelId, memberId)),
        this.refreshDetail({ channelId }),
      ]),
    );
  };
  /**
   * Members join one at a time: each add takes the Channel row lock. Both adds are
   * idempotent, so retrying after a partial failure does not duplicate anyone.
   */
  addMembers = async (
    channelId: string,
    { agents = [], userIds = [] }: { agents?: ChannelAgentSelection[]; userIds?: string[] },
  ) => {
    try {
      for (const userId of userIds) await channelService.addUser(channelId, userId);
      for (const agent of agents) await channelService.addAgent(channelId, agent);
    } finally {
      // A partial failure still shows the members that did join.
      await this.#refreshAfterWrite(() => this.refreshDetail({ channelId }));
    }
  };
  /**
   * Adds one person or Agent, as an @mention of someone outside the Channel does, and returns
   * the member id the mention resolves to. Idempotent like `addMembers`.
   */
  addMember = async (
    channelId: string,
    member: { agent: ChannelAgentSelection } | { userId: string },
  ) => {
    const { data } =
      'userId' in member
        ? await channelService.addUser(channelId, member.userId)
        : await channelService.addAgent(channelId, member.agent);
    await this.#refreshAfterWrite(() => this.refreshDetail({ channelId }));
    return data.id;
  };
  /** Waits for the server and the views it changed; the first message of a new thread uses it. */
  send = async (input: ChannelSendInput) => {
    const scope = cacheScope.get();
    const { data } = await channelService.send(input);
    if (cacheScope.get() === scope) await this.#refreshAfterSend(input, data.threadId);
    return data;
  };
  /**
   * Sends without waiting: the message shows in its conversation at once, marked sending, and a
   * failure keeps it there to retry. One conversation's messages reach the server in order.
   * Resolves the stored message, or `undefined` when it did not send.
   */
  queueSend = (input: ChannelQueuedSendInput) => {
    const message: ChannelOutgoingMessage = {
      ...input,
      createdAt: new Date(),
      requestKey: crypto.randomUUID(),
      scope: cacheScope.get(),
      status: 'sending',
      threadId: input.threadId ?? null,
    };
    this.#setOutbox((outbox) => addOutgoing(outbox, message), 'add');
    channelOutboxStorage.save(message);
    return this.#deliver(message);
  };
  /** Sends a failed message again under the same request key, so it is stored at most once. */
  retrySend = (message: ChannelOutgoingMessage) => {
    if (findOutgoing(useChannelStore.getState().outbox, message)?.status !== 'failed')
      return Promise.resolve(undefined);
    this.#setOutbox((outbox) => patchOutgoing(outbox, message, { status: 'sending' }), 'retry');
    return this.#deliver(message);
  };
  discardSend = (message: ChannelOutgoingMessage) => {
    this.#setOutbox((outbox) => removeOutgoing(outbox, message), 'discard');
    channelOutboxStorage.forget(message);
  };
  /** Scopes whose unsent messages were read back after a reload; once per scope and session. */
  readonly #restoredScopes = new Set<string>();
  /** Brings back the scope's unsent messages from an earlier page load, marked failed. */
  restoreOutbox = (scope: string) => {
    if (this.#restoredScopes.has(scope)) return;
    this.#restoredScopes.add(scope);
    const stored = channelOutboxStorage.load(scope);
    if (!stored.length) return;
    this.#setOutbox(
      (outbox) =>
        stored.reduce(
          (next, message) => (findOutgoing(next, message) ? next : addOutgoing(next, message)),
          outbox,
        ),
      'restore',
    );
  };
  #setOutbox = (fn: (outbox: ChannelOutbox) => ChannelOutbox, action: string) =>
    useChannelStore.setState(
      (state) => ({ outbox: fn(state.outbox) }),
      false,
      `channel/outbox/${action}`,
    );
  /** The tail of each conversation's sends; a message waits for the ones queued before it. */
  readonly #deliveries = new Map<string, Promise<unknown>>();
  #deliver = (message: ChannelOutgoingMessage) => {
    const key = channelOutboxKey(message.channelId, message.threadId);
    const result = (this.#deliveries.get(key) ?? Promise.resolve()).then(() => this.#post(message));
    this.#deliveries.set(key, result);
    void result.then(() => {
      if (this.#deliveries.get(key) === result) this.#deliveries.delete(key);
    });
    return result;
  };
  #post = async (queued: ChannelOutgoingMessage) => {
    // It may have been discarded, or the identity switched, while it waited for its turn.
    const message = findOutgoing(useChannelStore.getState().outbox, queued);
    if (message?.status !== 'sending') return;
    // Never under another identity; it stays in its own scope to retry after switching back.
    if (message.scope !== cacheScope.get()) {
      this.#setOutbox((outbox) => patchOutgoing(outbox, message, { status: 'failed' }), 'failed');
      return;
    }
    const input = {
      channelId: message.channelId,
      content: message.content,
      fileIds: message.fileIds,
      mentions: message.mentions,
      replyToId: message.replyToId,
      requestKey: message.requestKey,
      threadId: message.threadId,
    };
    try {
      const { data } = await channelService.send(input);
      // Shown as sent until a refreshed page of its conversation holds it.
      this.#setOutbox(
        (outbox) =>
          patchOutgoing(outbox, message, {
            sent: { id: data.id, sequence: data.sequence, threadId: data.threadId },
            status: 'sent',
          }),
        'sent',
      );
      channelOutboxStorage.forget(message);
      if (cacheScope.get() === message.scope) void this.#refreshAfterSend(input, data.threadId);
      return data;
    } catch (error) {
      console.error('Failed to send Channel message', error);
      this.#setOutbox((outbox) => patchOutgoing(outbox, message, { status: 'failed' }), 'failed');
    }
  };
  #refreshAfterSend = (input: ChannelSendInput, threadId: string | null) =>
    this.#refreshAfterWrite(() =>
      Promise.all([
        this.refreshDetail({ channelId: input.channelId, threadId }),
        ...(input.rootMessageId || (input.replyToId && threadId)
          ? [this.refreshDetail({ channelId: input.channelId })]
          : []),
        this.refreshList(),
      ]),
    );
  stop = async (channelId: string, scope: Parameters<typeof channelService.stop>[1]) => {
    await channelService.stop(channelId, scope);
    await this.refreshDetail({ channelId, threadId: 'threadId' in scope ? scope.threadId : null });
  };
  reset = () => {
    this.#private.resetThreadRemovals();
    this.#deliveries.clear();
    this.#restoredScopes.clear();
    useChannelStore.setState(initialState, false, 'channel/reset');
  };
}

export const channelActions = new ChannelActionImpl();
