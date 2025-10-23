import { UserStore } from '@/store/user';
import {
  AWSBedrockKeyVault,
  AzureOpenAIKeyVault,
  ComfyUIKeyVault,
  GlobalLLMProviderKey,
  OpenAICompatibleKeyVault,
  UserKeyVaults,
} from '@/types/user/settings';

import { currentSettings } from '../../settings/selectors/settings';

export const keyVaultsSettings = (s: UserStore): UserKeyVaults =>
  currentSettings(s).keyVaults || {};

const openAIConfig = (s: UserStore) => keyVaultsSettings(s).openai || {};
const bedrockConfig = (s: UserStore) => keyVaultsSettings(s).bedrock || {};
const ollamaConfig = (s: UserStore) => keyVaultsSettings(s).ollama || {};
const azureConfig = (s: UserStore) => keyVaultsSettings(s).azure || {};
const cloudflareConfig = (s: UserStore) => keyVaultsSettings(s).cloudflare || {};
const getVaultByProvider = (provider: GlobalLLMProviderKey) => (s: UserStore) =>
  (keyVaultsSettings(s)[provider] || {}) as OpenAICompatibleKeyVault &
    AzureOpenAIKeyVault &
    AWSBedrockKeyVault &
    ComfyUIKeyVault;

const isProviderEndpointNotEmpty = (provider: string) => (s: UserStore) => {
  const vault = getVaultByProvider(provider as GlobalLLMProviderKey)(s);
  return !!vault?.baseURL || !!vault?.endpoint;
};

const isProviderApiKeyNotEmpty = (provider: string) => (s: UserStore) => {
  const vault = getVaultByProvider(provider as GlobalLLMProviderKey)(s);
  return !!vault?.apiKey || !!vault?.accessKeyId || !!vault?.secretAccessKey;
};

const password = (s: UserStore) => keyVaultsSettings(s).password || '';

export const keyVaultsConfigSelectors = {
  azureConfig,
  bedrockConfig,
  cloudflareConfig,
  getVaultByProvider,
  isProviderApiKeyNotEmpty,
  isProviderEndpointNotEmpty,
  keyVaultsSettings,
  ollamaConfig,
  openAIConfig,
  password,
};
