import type { ReplicaSyncResult } from '@/libs/replica';
import { messengerService } from '@/services/messenger';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { initialMessengerState, type MessengerState } from './initialState';
import { MessengerPrivateAction } from './privateAction';
import {
  MESSENGER_LIST_KEY,
  MESSENGER_LIST_PARAMS,
  type MessengerInstallationItem,
  type MessengerLinkItem,
  type MessengerPushWindowParams,
} from './projection';
import { useMessengerStore } from './store';

const n = setNamespace('messenger');

/**
 * The settings page, the file row menus (one hook per row) and the verify flow
 * all read the same lists: collapse their mounts into one request.
 */
const LIST_DEDUPING_INTERVAL = 10_000;

const PUSH_WINDOW_REFRESH_INTERVAL = 5000;

type MessengerPlatform = MessengerPushWindowParams['platform'];

interface LinkTarget {
  platform: MessengerPlatform;
  tenantId?: string;
}

interface ListSyncOptions {
  enabled?: boolean;
  revalidateOnFocus?: boolean;
}

/** Without a tenant the server addresses the platform's only (global) link. */
const matchesTarget =
  ({ platform, tenantId }: LinkTarget) =>
  (row: { platform: string; tenantId: string }) =>
    row.platform === platform && (!tenantId || row.tenantId === tenantId);

type Setter = StoreSetter<MessengerState>;

export class MessengerActionImpl {
  readonly #private: MessengerPrivateAction;
  readonly #set: Setter;

  constructor(set: Setter, _get: () => MessengerState, privateAction: MessengerPrivateAction) {
    this.#set = set;
    this.#private = privateAction;
  }

  reset = (): void => {
    this.#set(initialMessengerState, false, n('reset'));
  };

  useFetchPlatforms = ({ enabled = true, revalidateOnFocus }: ListSyncOptions = {}) =>
    this.#private.platforms.useSync(MESSENGER_LIST_PARAMS, {
      dedupingInterval: LIST_DEDUPING_INTERVAL,
      enabled,
      revalidateOnFocus,
    });

  useFetchLinks = ({ enabled = true, revalidateOnFocus }: ListSyncOptions = {}) =>
    this.#private.links.useSync(MESSENGER_LIST_PARAMS, {
      dedupingInterval: LIST_DEDUPING_INTERVAL,
      enabled,
      revalidateOnFocus,
    });

  useFetchInstallations = ({ enabled = true, revalidateOnFocus }: ListSyncOptions = {}) =>
    this.#private.installations.useSync(MESSENGER_LIST_PARAMS, {
      dedupingInterval: LIST_DEDUPING_INTERVAL,
      enabled,
      revalidateOnFocus,
    });

  useFetchBindingScopes = (enabled: boolean): ReplicaSyncResult =>
    this.#private.bindingScopes.useSync(MESSENGER_LIST_PARAMS, {
      dedupingInterval: LIST_DEDUPING_INTERVAL,
      enabled,
    });

  useFetchBindingAgents = (workspaceId: string | null | undefined): ReplicaSyncResult =>
    this.#private.bindingAgents.useSync(
      { workspaceId: workspaceId ?? null },
      { dedupingInterval: LIST_DEDUPING_INTERVAL },
    );

  /** WeChat's window moves with every inbound message, so it polls while shown. */
  useFetchPushWindow = (params: MessengerPushWindowParams): ReplicaSyncResult =>
    this.#private.pushWindow.useSync(params, {
      refreshInterval: params.platform === 'wechat' ? PUSH_WINDOW_REFRESH_INTERVAL : 0,
      refreshWhenHidden: false,
      refreshWhenOffline: false,
    });

  refreshPlatforms = () => this.#private.platforms.fetch(MESSENGER_LIST_PARAMS, { fresh: true });

  refreshLinks = () => this.#private.links.fetch(MESSENGER_LIST_PARAMS, { fresh: true });

  refreshInstallations = () =>
    this.#private.installations.fetch(MESSENGER_LIST_PARAMS, { fresh: true });

  refreshConnections = () => Promise.all([this.refreshLinks(), this.refreshInstallations()]);

  refreshPushWindow = (params: MessengerPushWindowParams) =>
    this.#private.pushWindow.fetch(params, { fresh: true });

  /**
   * Refresh after a write that already committed. A failed refresh must not
   * read as a failed write (the caller would toast an error for a change that
   * went through); the next sync catches up.
   */
  #refreshAfterWrite = async (refresh: () => Promise<unknown>) => {
    try {
      await refresh();
    } catch (error) {
      console.error('Failed to refresh Messenger after a write', error);
    }
  };

  /**
   * Route the link's conversations to another agent. The link shows the pick
   * at once and adopts the server's row (which also carries the derived
   * workspace); a failure restores the previous agent.
   */
  setActiveAgent = async (target: LinkTarget & { agentId: string | null }) => {
    const matches = matchesTarget(target);
    await this.#private.links.optimistic(
      MESSENGER_LIST_KEY,
      (items) =>
        items?.map((link) => (matches(link) ? { ...link, activeAgentId: target.agentId } : link)),
      () =>
        messengerService.setActiveAgent({
          agentId: target.agentId,
          platform: target.platform,
          tenantId: target.tenantId,
        }),
      {
        confirm:
          ({ data }) =>
          (items) =>
            items?.map((link) => (link.id === data.id ? (data as MessengerLinkItem) : link)),
      },
    );
  };

  /**
   * Remove an account link. The row leaves the lists (and their persisted
   * copies) once the server confirms, so a reload cannot bring it back; a
   * WeChat connection is listed through its link, so its installation view goes
   * with it. A failure restores both.
   */
  unlink = async (target: LinkTarget) => {
    const matches = matchesTarget(target);
    await this.#private.links.optimistic(
      MESSENGER_LIST_KEY,
      (items) => items?.filter((link) => !matches(link)),
      () =>
        this.#private.installations.optimistic(
          MESSENGER_LIST_KEY,
          (items) =>
            target.platform === 'wechat'
              ? items?.filter((installation) => !matches(installation))
              : items,
          () => messengerService.unlink({ platform: target.platform, tenantId: target.tenantId }),
        ),
    );
    await this.#refreshAfterWrite(this.refreshConnections);
  };

  /** Disconnect a Slack / Discord installation; links served through it are re-read. */
  uninstallInstallation = async (installationId: string) => {
    await this.#private.installations.optimistic(
      MESSENGER_LIST_KEY,
      (items) =>
        items?.filter(
          (installation: MessengerInstallationItem) => installation.id !== installationId,
        ),
      () => messengerService.uninstallInstallation({ installationId }),
    );
    await this.#refreshAfterWrite(this.refreshConnections);
  };

  /** A connection completed out of band (QR scan, iMessage handshake). */
  refreshAfterConnect = () => this.#refreshAfterWrite(this.refreshConnections);

  sendPush = async (
    params: Parameters<typeof messengerService.sendMessengerPush>[0],
  ): ReturnType<typeof messengerService.sendMessengerPush> => {
    const result = await messengerService.sendMessengerPush(params);
    // Every send spends window quota (or queues), whatever the outcome.
    await this.#refreshAfterWrite(() =>
      this.refreshPushWindow({ platform: params.platform, tenantId: params.tenantId }),
    );
    return result;
  };
}

export const messengerActions = new MessengerActionImpl(
  useMessengerStore.setState,
  useMessengerStore.getState,
  new MessengerPrivateAction(useMessengerStore.setState, useMessengerStore.getState),
);
