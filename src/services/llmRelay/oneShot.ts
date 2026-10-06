import type {
  AgentStreamEvent,
  LlmCancelData,
  LlmExecuteData,
} from '@lobechat/agent-gateway-client';
import {
  buildLlmRelayChannelId,
  LLM_RELAY_CHANNEL_HEADER,
  LLM_RELAY_CLIENT_ID_HEADER,
} from '@lobechat/agent-gateway-client';
import debug from 'debug';

import { getLlmRelayClientId } from './clientId';

const log = debug('lobe-client:llm-relay:one-shot');

/**
 * Client half of the one-shot relay (T-667): an LLM call this tab asks the
 * server for — a translation, a topic title, a provider check — whose provider
 * only this device can reach. The tab subscribes to a fresh gateway channel,
 * names it in the request headers, and executes the `llm_execute` the server
 * dispatches on it with its own provider configuration (the same executor as
 * relayed agent runs). The browser never calls the provider on its own.
 */

/** What a request must carry so the server relays its LLM calls back here. */
export interface OneShotRelayHandle {
  channel: string;
  headers: Record<string, string>;
}

/** A subscription to one channel; `ready` resolves once the gateway took it. */
export interface OneShotChannelSubscription {
  close: () => void;
  ready: Promise<void>;
}

export interface OneShotRelayDeps {
  clientId?: () => string;
  /** The deployment can relay: `agent_llm_relay` is on and an Agent Gateway is configured. */
  isAvailable: () => boolean;
  /** Whether calls to `provider` leave from this device (shared `fetchOnClient` rule). */
  isDeviceProvider: (provider: string) => boolean;
  /** Run a relayed call this channel delivered. */
  onCancel: (data: LlmCancelData) => void;
  onExecute: (data: LlmExecuteData) => void;
  /** Subscribe to `channel` on the gateway as its executor. */
  subscribe: (
    channel: string,
    onEvent: (event: AgentStreamEvent) => void,
  ) => Promise<OneShotChannelSubscription>;
  userId: () => string | undefined;
}

/** How long a request waits for its channel subscription before going ahead anyway. */
export const ONE_SHOT_SUBSCRIBE_TIMEOUT_MS = 5000;

const randomNonce = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

const withTimeout = (promise: Promise<void>, ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });

export class OneShotRelay {
  constructor(private readonly deps: OneShotRelayDeps) {}

  /**
   * Whether a call to `provider` is relayed back to this tab: the deployment
   * relays, the provider only runs from the device, and the user is known (a
   * channel is named after them). Callers drop their browser fetcher on this,
   * so it must match what `run` actually does.
   */
  needsRelay(provider: string | undefined): provider is string {
    return (
      !!provider &&
      this.deps.isAvailable() &&
      this.deps.isDeviceProvider(provider) &&
      !!this.deps.userId()
    );
  }

  /**
   * Run `request` with this tab standing by as the executor of its LLM calls
   * to `provider`: `request` gets the headers to send, and the channel is
   * released once it settles. A provider the server reaches itself runs
   * `request` as-is, without a channel.
   */
  async run<T>(
    provider: string | undefined,
    request: (relay?: OneShotRelayHandle) => Promise<T>,
  ): Promise<T> {
    if (!this.needsRelay(provider)) return request();

    const channel = buildLlmRelayChannelId(this.deps.userId()!, randomNonce());
    const subscribing = this.deps.subscribe(channel, (event) => {
      if (event.type === 'llm_execute') this.deps.onExecute(event.data as LlmExecuteData);
      else if (event.type === 'llm_cancel') this.deps.onCancel(event.data as LlmCancelData);
    });

    try {
      // The server dispatches as soon as the request lands: be subscribed
      // first, or the gateway finds nobody to deliver the call to. The setup
      // (a gateway token request on the v1 path) counts against the same
      // timeout; past it, or if it fails, the request goes ahead and the
      // server reports the relay failure.
      await withTimeout(
        subscribing.then((subscription) => subscription.ready),
        ONE_SHOT_SUBSCRIBE_TIMEOUT_MS,
      );
      log('channel %s ready for %s', channel, provider);

      return await request({
        channel,
        headers: {
          [LLM_RELAY_CHANNEL_HEADER]: channel,
          [LLM_RELAY_CLIENT_ID_HEADER]: (this.deps.clientId ?? getLlmRelayClientId)(),
        },
      });
    } finally {
      // A subscription that lands after the request settled is released too.
      subscribing.then(
        (subscription) => subscription.close(),
        (error) => log('channel %s subscription failed: %O', channel, error),
      );
    }
  }
}
