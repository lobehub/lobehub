import type { ProviderImportPayload } from '@lobechat/electron-client-ipc';
import type { AiProviderConfig, AiProviderDetailItem } from 'model-bank/aiProvider';
import { AiProviderSourceEnum } from 'model-bank/aiProvider';

import { mutate } from '@/libs/swr';
import { aiModelKeys } from '@/libs/swr/keys';
import { aiModelService } from '@/services/aiModel';
import { aiProviderService } from '@/services/aiProvider';
import { useAiInfraStore } from '@/store/aiInfra';
import { AiProviderSwrKey } from '@/store/aiInfra/slices/aiProvider/action';

export class BuiltinProviderImportError extends Error {}
export class ProviderOverwriteNotConfirmedError extends Error {}
export class PartialProviderImportError extends Error {
  constructor(readonly providerIdentity?: string) {
    super();
  }
}

const isLoopbackEndpoint = (baseURL: string) => {
  const hostname = new URL(baseURL).hostname;
  return hostname === '127.0.0.1' || hostname === '[::1]';
};

const readExistingProviderConfig = (
  provider: AiProviderDetailItem,
): AiProviderConfig | undefined => {
  const config = (provider as AiProviderDetailItem & { config?: AiProviderConfig }).config;
  if (!config || typeof config !== 'object') return undefined;

  return config;
};

const restoreOverwrittenProvider = async (existing: AiProviderDetailItem) => {
  await aiProviderService.updateAiProvider(existing.id, {
    description: existing.description,
    logo: existing.logo,
    name: existing.name,
    settings: existing.settings,
  });
  await aiProviderService.updateAiProviderConfig(existing.id, {
    checkModel: existing.checkModel,
    config: readExistingProviderConfig(existing),
    fetchOnClient: existing.fetchOnClient,
    keyVaults: existing.keyVaults,
  });
  await aiProviderService.toggleProviderEnabled(existing.id, existing.enabled);
};

export const applyProviderImport = async (
  { models, provider }: ProviderImportPayload,
  options: { expectedProviderIdentity?: string },
) => {
  const existing = await aiProviderService.getAiProviderById(provider.id);

  if (existing?.source === AiProviderSourceEnum.Builtin) {
    throw new BuiltinProviderImportError();
  }
  if (
    existing &&
    (!options.expectedProviderIdentity || existing.identity !== options.expectedProviderIdentity)
  ) {
    throw new ProviderOverwriteNotConfirmedError();
  }

  const existingSettings = existing?.settings;
  const settings = {
    ...existingSettings,
    searchMode: existingSettings?.searchMode === 'tool' ? undefined : existingSettings?.searchMode,
    sdkType: 'openai' as const,
    supportResponsesApi: true,
  };

  let createdProvider = false;
  let writesComplete = false;

  try {
    if (existing) {
      await aiProviderService.updateAiProvider(provider.id, {
        description: provider.description,
        logo: provider.logo,
        name: provider.name,
        settings,
      });
    } else {
      await aiProviderService.createAiProvider({
        description: provider.description,
        id: provider.id,
        keyVaults: { apiKey: provider.apiKey, baseURL: provider.baseURL },
        logo: provider.logo,
        name: provider.name,
        settings,
        source: AiProviderSourceEnum.Custom,
      });
      createdProvider = true;
    }

    await aiProviderService.updateAiProviderConfig(provider.id, {
      checkModel: provider.checkModel,
      config: { enableResponseApi: provider.enableResponsesApi ?? false },
      fetchOnClient: isLoopbackEndpoint(provider.baseURL) || (provider.fetchOnClient ?? false),
      keyVaults: { apiKey: provider.apiKey, baseURL: provider.baseURL },
    });
    await aiProviderService.toggleProviderEnabled(provider.id, true);

    if (models.length > 0) {
      await aiModelService.batchUpdateAiModels(
        provider.id,
        models.map((model) => ({
          ...model,
          enabled: true,
          source: 'remote',
          type: 'chat',
        })),
        { forceType: 'chat' },
      );
      await aiModelService.batchToggleAiModels(
        provider.id,
        models.map(({ id }) => id),
        true,
      );
    }

    writesComplete = true;

    const store = useAiInfraStore.getState();
    await Promise.all([
      mutate([AiProviderSwrKey.fetchAiProviderItem, provider.id]),
      mutate(aiModelKeys.list(provider.id)),
      store.refreshAiProviderList(),
      store.refreshAiProviderRuntimeState(),
    ]);
  } catch (error) {
    if (writesComplete) throw error;

    if (createdProvider) {
      const partialProvider = await aiProviderService
        .getAiProviderById(provider.id)
        .catch((lookupError: unknown) => {
          console.error('Failed to read the partial provider after import', lookupError);
          return undefined;
        });
      throw new PartialProviderImportError(partialProvider?.identity);
    }

    if (existing) {
      try {
        await restoreOverwrittenProvider(existing);
      } catch (restoreError) {
        console.error('Failed to restore provider after a partial import', restoreError);
        throw new PartialProviderImportError(existing.identity);
      }
      throw error;
    }

    throw error;
  }
};
