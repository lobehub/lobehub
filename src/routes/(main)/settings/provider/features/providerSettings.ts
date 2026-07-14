import { isProviderOAuthDeviceFlow } from 'model-bank/modelProviders';

import { type AiProviderSDKType, type AiProviderSettings } from '@/types/aiProvider';

const RESPONSE_API_SUPPORTED_SDK_TYPES = new Set<AiProviderSDKType>(['openai', 'router']);

export const isResponsesApiSupportedSdkType = (sdkType?: AiProviderSDKType) => {
  if (!sdkType) return false;

  return RESPONSE_API_SUPPORTED_SDK_TYPES.has(sdkType);
};

interface ShouldShowProviderFooterParams {
  isCustomBranding: boolean;
  providerId?: string;
}

// Subscription OAuth providers source models from the user's own account,
// so the "more providers coming" footer reads as a misleading model roadmap there.
export const shouldShowProviderFooter = ({
  isCustomBranding,
  providerId,
}: ShouldShowProviderFooterParams) => !isCustomBranding && !isProviderOAuthDeviceFlow(providerId);

interface NormalizeProviderSettingsParams {
  nextSettings?: AiProviderSettings;
  previousSettings?: AiProviderSettings;
}

export const normalizeProviderSettings = ({
  nextSettings,
  previousSettings,
}: NormalizeProviderSettingsParams): AiProviderSettings | undefined => {
  const mergedSettings = {
    ...previousSettings,
    ...nextSettings,
  };

  const sdkType = mergedSettings.sdkType;

  if (isResponsesApiSupportedSdkType(sdkType)) {
    return {
      ...mergedSettings,
      supportResponsesApi: true,
    };
  }

  const { supportResponsesApi: _removedSupportResponsesApi, ...restSettings } = mergedSettings;

  if (Object.keys(restSettings).length === 0) return undefined;

  return restSettings;
};
