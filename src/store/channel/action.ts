import type { ChannelPublicThread, ChannelStatus, ChannelThreadStatus } from '@lobechat/types';

import { cacheScope } from '@/libs/replica';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { channelKeys } from '@/libs/swr/keys';
import {
  type ChannelAgentSelection,
  channelService,
  type ChannelViewParams,
} from '@/services/channel';

import { ChannelPrivateAction } from './privateAction';
import { channelThreadEntityId } from './projection';
import { channelSelectors } from './selectors';
import { initialState, useChannelStore } from './store';

/**
 * Gateway push is not delivered yet, so polling is the only refresh: views with work in
 * progress refresh every few seconds, idle views and the list once a minute.
 */
export const CHANNEL_ACTIVE_REFRESH_MS = 3000;
export const CHANNEL_IDLE_REFRESH_MS = 60_000;

class ChannelActionImpl {
  readonly #private = new ChannelPrivateAction(useChannelStore.setState, useChannelStore.getState);
  useFetchUserCandidates = (channelId: string, search: string) =>
    useClientDataSWR(channelKeys.userCandidates(channelId, search), () =>
      channelService.userCandidates(channelId, search),
    );
  useFetchList = () => this.#private.list.useSync({}, { refreshInterval: CHANNEL_IDLE_REFRESH_MS });
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
  send = async (input: Parameters<typeof channelService.send>[0]) => {
    const scope = cacheScope.get();
    const { data } = await channelService.send(input);
    if (cacheScope.get() !== scope) return data;
    await this.#refreshAfterWrite(() =>
      Promise.all([
        this.refreshDetail({ channelId: input.channelId, threadId: data.threadId }),
        ...(input.rootMessageId || (input.replyToId && data.threadId)
          ? [this.refreshDetail({ channelId: input.channelId })]
          : []),
        this.refreshList(),
      ]),
    );
    return data;
  };
  stop = async (channelId: string, scope: Parameters<typeof channelService.stop>[1]) => {
    await channelService.stop(channelId, scope);
    await this.refreshDetail({ channelId, threadId: 'threadId' in scope ? scope.threadId : null });
  };
  reset = () => {
    this.#private.resetThreadRemovals();
    useChannelStore.setState(initialState, false, 'channel/reset');
  };
}

export const channelActions = new ChannelActionImpl();
