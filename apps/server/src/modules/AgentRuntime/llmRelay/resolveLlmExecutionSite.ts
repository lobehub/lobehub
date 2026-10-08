import type { AgentState } from '@lobechat/agent-runtime';
import { DEFAULT_LLM_CONFIG } from '@lobechat/business-config';
import { BRANDING_PROVIDER } from '@lobechat/business-const';
import debug from 'debug';
import { ModelProvider } from 'model-bank';

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
  | { preferredClientId: string; runtimeProvider: string; site: 'client' }
  | { reason: ClientLlmUnavailableReason; site: 'unavailable' };

export interface ResolveLlmExecutionSiteParams {
  db: LobeChatDatabase;
  provider: string;
  state?: Pick<AgentState, 'host' | 'principal'>;
  userId: string;
  workspaceId?: string;
}

const SERVER: LlmExecutionSite = { site: 'server' };

/**
 * `fetchOnClient` as the client store reads it: the user's choice when they
 * made one, else this deployment's override from the server global config
 * (desktop, `OLLAMA_PROXY_URL`), else the provider default (Ollama / LM Studio
 * / Unsloth ship with `fetchOnClient: true`).
 */
const resolveFetchOnClient = (provider: string, stored: boolean | undefined) =>
  stored ??
  getServerFetchOnClientOverride(provider) ??
  (DEFAULT_LLM_CONFIG as Record<string, { fetchOnClient?: boolean } | undefined>)[provider]
    ?.fetchOnClient;

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
  if (provider === BRANDING_PROVIDER || provider === ModelProvider.LobeHub) return SERVER;
  if (state?.principal?.actor?.shareVisitor) return SERVER;

  const featureFlags = await getServerFeatureFlagsStateFromRuntimeConfig(userId);
  if (!featureFlags.enableLlmRelay) return SERVER;

  const config = await new AiProviderModel(db, userId, workspaceId).getAiProviderById(
    provider,
    KeyVaultsGateKeeper.getUserKeyVaults,
  );
  const fetchOnClient = resolveFetchOnClient(provider, config?.fetchOnClient) === true;

  log('provider=%s fetchOnClient=%s', provider, fetchOnClient);
  if (!fetchOnClient) return SERVER;

  const executor = state?.host?.llmExecutor;
  const canExecute =
    !!executor?.clientId &&
    executor.capabilities.includes(LLM_RELAY_CAPABILITY) &&
    executor.providers.includes(provider);
  if (!canExecute) return { reason: 'no_executor', site: 'unavailable' };

  return {
    preferredClientId: executor.clientId,
    runtimeProvider: resolveRuntimeProvider(provider, config?.settings?.sdkType),
    site: 'client',
  };
};
