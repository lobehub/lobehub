import type { AgentState } from '@lobechat/agent-runtime';
import { BRANDING_PROVIDER } from '@lobechat/business-const';
import debug from 'debug';
import { ModelProvider } from 'model-bank';
import { isProviderFetchOnClient } from 'model-bank/modelProviders';

import { AiProviderModel } from '@/database/models/aiProvider';
import type { LobeChatDatabase } from '@/database/type';
import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';
import { getServerFetchOnClientOverride } from '@/server/globalConfig/serverFetchOnClient';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { resolveRuntimeProvider } from '@/server/modules/ModelRuntime';

import type { ClientLlmUnavailableReason } from './errors';
import { LLM_RELAY_CAPABILITY } from './protocol';

const log = debug('lobe-server:agent-runtime:llm-relay:site');

export type LlmExecutionSite =
  | { site: 'server' }
  | {
      /** Channel to dispatch on when the executor listens on another run's; see `AgentRunLlmExecutor`. */
      channelOperationId?: string;
      preferredClientId: string;
      runtimeProvider: string;
      site: 'client';
    }
  | { reason: ClientLlmUnavailableReason; site: 'unavailable' };

export interface ResolveLlmExecutionSiteParams {
  db: LobeChatDatabase;
  provider: string;
  state?: Pick<AgentState, 'host' | 'principal'>;
  userId: string;
  workspaceId?: string;
}

const SERVER: LlmExecutionSite = { site: 'server' };

export interface ResolveProviderRelayParams {
  db: LobeChatDatabase;
  provider: string;
  userId: string;
  workspaceId?: string;
}

/**
 * Whether calls to `provider` must run on the user's device, i.e. be relayed:
 * the relay is on for the user, the provider is not platform-owned, and the
 * shared `fetchOnClient` rule — the one the client store applies, on the
 * user's config with this deployment's override (desktop, `OLLAMA_PROXY_URL`)
 * as the default — sends it to the device. `undefined` keeps it on the server.
 */
export const resolveProviderRelay = async ({
  db,
  provider,
  userId,
  workspaceId,
}: ResolveProviderRelayParams): Promise<{ runtimeProvider: string } | undefined> => {
  if (provider === BRANDING_PROVIDER || provider === ModelProvider.LobeHub) return;

  const featureFlags = await getServerFeatureFlagsStateFromRuntimeConfig(userId);
  if (!featureFlags.enableLlmRelay) return;

  const config = await new AiProviderModel(db, userId, workspaceId).getAiProviderById(
    provider,
    KeyVaultsGateKeeper.getUserKeyVaults,
  );
  const fetchOnClient = isProviderFetchOnClient(provider, {
    fetchOnClient: config?.fetchOnClient ?? getServerFetchOnClientOverride(provider),
    keyVaults: config?.keyVaults as { apiKey?: string; baseURL?: string } | undefined,
  });

  log('provider=%s fetchOnClient=%s', provider, fetchOnClient);
  if (!fetchOnClient) return;

  return { runtimeProvider: resolveRuntimeProvider(provider, config?.settings?.sdkType) };
};

/**
 * Where one LLM call of a run executes (T-540 §2.1). The server is the
 * authority — the client only declares that it *can* execute
 * (`state.host.llmExecutor`).
 *
 * - `server`: the default. Also kept when the relay is off for this user, for
 *   platform-owned providers (their credentials never go to a client), and for
 *   shared-agent visitor runs (the creator's provider config is not the
 *   visitor's to run).
 * - `client`: the provider is one only the user's device can reach — it runs
 *   with client requests (`fetchOnClient`) — and the run's client declared it
 *   can execute that provider.
 * - `unavailable`: such a provider, but no client to execute it.
 */
export const resolveLlmExecutionSite = async ({
  db,
  provider,
  state,
  userId,
  workspaceId,
}: ResolveLlmExecutionSiteParams): Promise<LlmExecutionSite> => {
  if (state?.principal?.actor?.shareVisitor) return SERVER;

  const relay = await resolveProviderRelay({ db, provider, userId, workspaceId });
  if (!relay) return SERVER;

  const executor = state?.host?.llmExecutor;
  const canExecute =
    !!executor?.clientId &&
    executor.capabilities.includes(LLM_RELAY_CAPABILITY) &&
    executor.providers.includes(provider);
  if (!canExecute) return { reason: 'no_executor', site: 'unavailable' };

  return {
    ...(executor.channelOperationId && { channelOperationId: executor.channelOperationId }),
    preferredClientId: executor.clientId,
    runtimeProvider: relay.runtimeProvider,
    site: 'client',
  };
};
