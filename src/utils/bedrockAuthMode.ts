import { type AWSBedrockKeyVault } from '@lobechat/types';

import { type UpdateAiProviderConfigParams } from '@/types/aiProvider';

export enum BedrockAuthMode {
  ApiKey = 'apiKey',
  AwsCredentials = 'awsCredentials',
}

export const inferBedrockAuthMode = (
  keyVaults?: Pick<AWSBedrockKeyVault, 'accessKeyId' | 'apiKey' | 'secretAccessKey'>,
) => {
  if (keyVaults?.apiKey) return BedrockAuthMode.ApiKey;
  if (keyVaults?.accessKeyId || keyVaults?.secretAccessKey) return BedrockAuthMode.AwsCredentials;

  return BedrockAuthMode.ApiKey;
};

export const normalizeBedrockKeyVaultsForAuthMode = (
  authMode: BedrockAuthMode,
  keyVaults: UpdateAiProviderConfigParams['keyVaults'] = {},
): UpdateAiProviderConfigParams['keyVaults'] => {
  if (authMode === BedrockAuthMode.ApiKey) {
    return {
      ...keyVaults,
      accessKeyId: '',
      secretAccessKey: '',
      sessionToken: '',
    };
  }

  return {
    ...keyVaults,
    apiKey: '',
  };
};

export const normalizeBedrockConfigValues =
  (authMode: BedrockAuthMode) =>
  (values: UpdateAiProviderConfigParams): UpdateAiProviderConfigParams => ({
    ...values,
    keyVaults: normalizeBedrockKeyVaultsForAuthMode(authMode, values.keyVaults),
  });
