import type { LobeChatDatabase } from '@lobechat/database';
import type { ProviderConfig } from '@lobechat/types';

import { AiInfraRepos } from '@/database/repositories/aiInfra';
import { getServerGlobalConfig } from '@/server/globalConfig';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

export interface ClaudeCodeGatewayProvider {
  apiKey: string;
  baseURL: string;
}

const normalizeBaseURL = (value: string): string => {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('Claude Code Gateway providers must use HTTPS');
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.local') ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname)
  ) {
    throw new Error('Claude Code Gateway cannot reach private provider addresses');
  }

  let pathname = url.pathname.replace(/\/+$/, '');
  if (pathname.endsWith('/v1/messages')) pathname = pathname.slice(0, -'/v1/messages'.length);
  else if (pathname.endsWith('/v1')) pathname = pathname.slice(0, -'/v1'.length);
  url.pathname = `${pathname}/v1/messages`;
  url.search = '';
  url.hash = '';
  return url.toString();
};

export const resolveClaudeCodeGatewayProvider = async (params: {
  db: LobeChatDatabase;
  model: string;
  providerId: string;
  userId: string;
  workspaceId?: string;
}): Promise<ClaudeCodeGatewayProvider> => {
  const { aiProvider } = await getServerGlobalConfig();
  const state = await new AiInfraRepos(
    params.db,
    params.userId,
    aiProvider as Record<string, ProviderConfig>,
    params.workspaceId,
  ).getAiProviderRuntimeState(KeyVaultsGateKeeper.getUserKeyVaults);
  const provider = state.enabledAiProviders.find(({ id }) => id === params.providerId);
  const model = state.enabledAiModels.find(
    (item) =>
      item.providerId === params.providerId && item.id === params.model && item.type === 'chat',
  );
  const runtime = state.runtimeConfig[params.providerId];
  if (!provider || !model) throw new Error('Provider or model is disabled');
  if (runtime?.settings?.sdkType !== 'anthropic')
    throw new Error('Provider is not Anthropic compatible');
  if (runtime.settings.claudeCode?.gateway !== 'anthropic-messages') {
    throw new Error('Provider has not enabled the Claude Code Gateway');
  }

  const apiKey =
    typeof runtime.keyVaults?.apiKey === 'string' ? runtime.keyVaults.apiKey.trim() : '';
  if (!apiKey) throw new Error('Claude Code Gateway currently supports BYOK providers only');
  const configuredBaseURL =
    typeof runtime.keyVaults?.baseURL === 'string' && runtime.keyVaults.baseURL.trim()
      ? runtime.keyVaults.baseURL.trim()
      : 'https://api.anthropic.com';

  return { apiKey, baseURL: normalizeBaseURL(configuredBaseURL) };
};
