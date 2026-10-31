/**
 * Translation between bot-provider / messenger-link rows and the message
 * gateway: connect payloads out, connection status in.
 */
import type { DecryptedMessengerAccountLink } from '@/database/models/messengerAccountLink';
import { gatewayEnv } from '@/envs/gateway';
import type { BotRuntimeStatus } from '@/types/botRuntimeStatus';

import { hasPassiveListeningRule } from '../agentSignal/scenarios/botWake/config';
import { extractWatchKeywordEntries } from '../bot/platforms';
import type {
  MessageGatewayCapabilities,
  MessageGatewayConnectionConfig,
  MessageGatewayConnectionStatus,
} from './MessageGatewayClient';
import { BOT_RUNTIME_STATUSES } from './runtimeStatus';
import type { DesiredGatewayConnection } from './sync/types';

export function mapGatewayStatusToRuntimeStatus(
  status: MessageGatewayConnectionStatus['state']['status'],
): BotRuntimeStatus {
  switch (status) {
    case 'connected': {
      return BOT_RUNTIME_STATUSES.connected;
    }
    case 'connecting': {
      return BOT_RUNTIME_STATUSES.starting;
    }
    case 'disconnected': {
      return BOT_RUNTIME_STATUSES.disconnected;
    }
    case 'dormant': {
      return BOT_RUNTIME_STATUSES.dormant;
    }
    case 'error': {
      return BOT_RUNTIME_STATUSES.failed;
    }
  }
}

/**
 * Derive edge-filtering capabilities for a bot-channel connection from its
 * settings. Monitoring is enabled by "has any passive-listening rule": watch
 * keywords, or an enabled bot-wake scenario (its policies judge messages nobody
 * @-mentioned, which the gateway would otherwise drop at the edge).
 * Feature-access gating stays server-side (BotMessageRouter), so access
 * changes never require a gateway reconnect and operators with existing
 * rules are never cut off by a stale edge config.
 *
 * Unverified: the gateway itself lives outside this repository. That it
 * forwards un-mentioned channel messages once this flag is true is its
 * contract, not something this code can prove.
 */
export const resolveBotGatewayCapabilities = (
  settings?: Record<string, unknown> | null,
): MessageGatewayCapabilities => ({
  messageMonitoring: {
    enabled: hasPassiveListeningRule(
      settings,
      extractWatchKeywordEntries(settings ?? undefined).length,
    ),
  },
});

/**
 * The connect payload for one bot-channel provider.
 *
 * Extracted because two callers build it now: the periodic reconcile, which
 * pushes it to the gateway, and the gateway's own boot-time pull, which
 * receives it and connects itself. A second builder would drift, and the
 * connection the gateway ends up holding would then depend on which side
 * established it.
 *
 * Payload only, deliberately no side effects. The push path also writes a
 * runtime status from the connect result, but that belongs to whoever
 * actually connected: on the pull path the gateway does, so its state
 * callback is what reports the real status back. Guessing a status here would
 * record a connection as live that nothing has established yet.
 */
export const buildBotProviderConnectConfig = ({
  connectionMode,
  platform,
  provider,
}: DesiredGatewayConnection): MessageGatewayConnectionConfig => ({
  applicationId: provider.applicationId,
  capabilities: resolveBotGatewayCapabilities(provider.settings),
  connectionId: provider.id,
  connectionMode,
  credentials: provider.credentials,
  platform,
  userId: provider.userId,
  webhookPath: `/api/agent/webhooks/${platform}/${provider.applicationId}`,
});

/** The connect payload for one messenger polling link. Same rationale as above. */
export const buildMessengerPollingConnectConfig = ({
  connectionId,
  link,
  platform,
}: {
  connectionId: string;
  link: DecryptedMessengerAccountLink;
  platform: string;
}): MessageGatewayConnectionConfig => {
  const credentials = link.credentials as {
    baseUrl?: string;
    botId?: string;
    botToken?: string;
  };

  return {
    applicationId: link.applicationId!,
    // Messenger-owned connections never consume passive channel monitoring —
    // the shared bot only reacts to DMs and explicit mentions.
    capabilities: { messageMonitoring: { enabled: false } },
    connectionId,
    connectionMode: 'polling',
    credentials: {
      baseUrl: credentials.baseUrl,
      botId: credentials.botId,
      botToken: credentials.botToken,
      webhookToken: gatewayEnv.MESSAGE_GATEWAY_SERVICE_TOKEN,
    },
    platform,
    userId: link.userId,
    webhookPath: `/api/agent/messenger/webhooks/${platform}`,
  };
};
