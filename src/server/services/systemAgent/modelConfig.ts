import { BRANDING_PROVIDER } from '@lobechat/business-const';
import { loadModels } from '@lobechat/business-model-bank/model-config';
import { resolveBusinessModelMapping } from '@lobechat/business-model-runtime';
import { DEFAULT_SYSTEM_AGENT_CONFIG } from '@lobechat/const';
import type { SystemAgentItem, UserSystemAgentConfigKey } from '@lobechat/types';
import { isProviderModelAvailable } from 'model-bank';

interface ResolveSystemAgentModelConfigParams {
  override?: Partial<Pick<SystemAgentItem, 'model' | 'provider'>>;
  taskConfig?: Partial<SystemAgentItem>;
  taskKey: UserSystemAgentConfigKey;
}

const resolveAvailableLobeHubChatModel = async (model: string): Promise<string | undefined> => {
  try {
    const { resolvedModelId } = await resolveBusinessModelMapping(BRANDING_PROVIDER, model);

    if (isProviderModelAvailable(await loadModels(), BRANDING_PROVIDER, resolvedModelId, 'chat'))
      return resolvedModelId;
  } catch (error) {
    console.error('resolveSystemAgentModelConfig failed to resolve model availability:', error);
  }
};

export const resolveSystemAgentModelConfig = async ({
  override,
  taskConfig,
  taskKey,
}: ResolveSystemAgentModelConfigParams): Promise<{ model: string; provider: string }> => {
  const defaults = DEFAULT_SYSTEM_AGENT_CONFIG[taskKey];
  const model = override?.model || taskConfig?.model || defaults.model;
  const provider = override?.provider || taskConfig?.provider || defaults.provider;

  if (provider !== BRANDING_PROVIDER) return { model, provider };

  const availableModel = await resolveAvailableLobeHubChatModel(model);

  if (availableModel) return { model: availableModel, provider };

  return { model: defaults.model, provider: defaults.provider };
};
