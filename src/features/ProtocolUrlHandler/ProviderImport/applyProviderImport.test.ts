import type { ProviderImportPayload } from '@lobechat/electron-client-ipc';
import type { AiProviderDetailItem } from 'model-bank/aiProvider';
import { AiProviderSourceEnum } from 'model-bank/aiProvider';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { aiModelKeys } from '@/libs/swr/keys';
import { aiModelService } from '@/services/aiModel';
import { aiProviderService } from '@/services/aiProvider';
import { useAiInfraStore } from '@/store/aiInfra';
import { AiProviderSwrKey } from '@/store/aiInfra/slices/aiProvider/action';

import {
  applyProviderImport,
  BuiltinProviderImportError,
  PartialProviderImportError,
  ProviderOverwriteNotConfirmedError,
} from './applyProviderImport';

const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock('@/libs/swr', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  mutate: mocks.mutate,
}));

const payload: ProviderImportPayload = {
  models: [{ contextWindowTokens: 128_000, displayName: 'Example Model', id: 'example/model' }],
  provider: {
    apiKey: 'secret-key',
    baseURL: 'https://api.example.com/v1',
    checkModel: 'example/model',
    id: 'example-provider',
    name: 'Example Provider',
  },
  version: 1,
};

const emptyQueryResult = {
  command: '',
  fields: [],
  oid: 0,
  rowCount: 0,
  rows: [],
};

describe('applyProviderImport', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.mutate.mockReset().mockResolvedValue(undefined);
    vi.spyOn(aiProviderService, 'getAiProviderById').mockResolvedValue(undefined);
    vi.spyOn(aiProviderService, 'createAiProvider').mockResolvedValue('example-provider');
    vi.spyOn(aiProviderService, 'updateAiProvider').mockResolvedValue(emptyQueryResult);
    vi.spyOn(aiProviderService, 'updateAiProviderConfig').mockResolvedValue(emptyQueryResult);
    vi.spyOn(aiProviderService, 'toggleProviderEnabled').mockResolvedValue(emptyQueryResult);
    vi.spyOn(aiModelService, 'batchUpdateAiModels').mockResolvedValue([]);
    vi.spyOn(aiModelService, 'batchToggleAiModels').mockResolvedValue(undefined);
    vi.spyOn(useAiInfraStore.getState(), 'refreshAiProviderList').mockResolvedValue(undefined);
    vi.spyOn(useAiInfraStore.getState(), 'refreshAiProviderRuntimeState').mockResolvedValue(
      undefined,
    );
  });

  it('creates, enables, and populates a new provider', async () => {
    await applyProviderImport(payload, {});

    expect(aiProviderService.createAiProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'example-provider',
        keyVaults: { apiKey: 'secret-key', baseURL: 'https://api.example.com/v1' },
        settings: { sdkType: 'openai', supportResponsesApi: true },
        source: AiProviderSourceEnum.Custom,
      }),
    );
    expect(aiProviderService.updateAiProviderConfig).toHaveBeenCalledWith('example-provider', {
      checkModel: 'example/model',
      config: { enableResponseApi: false },
      fetchOnClient: false,
      keyVaults: { apiKey: 'secret-key', baseURL: 'https://api.example.com/v1' },
    });
    expect(aiProviderService.toggleProviderEnabled).toHaveBeenCalledWith('example-provider', true);
    expect(aiModelService.batchUpdateAiModels).toHaveBeenCalledWith(
      'example-provider',
      [
        {
          contextWindowTokens: 128_000,
          displayName: 'Example Model',
          enabled: true,
          id: 'example/model',
          source: 'remote',
          type: 'chat',
        },
      ],
      { forceType: 'chat' },
    );
    expect(aiModelService.batchToggleAiModels).toHaveBeenCalledWith(
      'example-provider',
      ['example/model'],
      true,
    );
  });

  it('updates an existing custom provider while preserving unrelated settings', async () => {
    vi.mocked(aiProviderService.getAiProviderById).mockResolvedValue({
      enabled: true,
      id: 'example-provider',
      identity: 'provider-row-1',
      name: 'Old Name',
      settings: { defaultShowBrowserRequest: true, sdkType: 'router' },
      source: AiProviderSourceEnum.Custom,
    });

    await applyProviderImport(
      {
        ...payload,
        provider: { ...payload.provider, enableResponsesApi: true, fetchOnClient: true },
      },
      { expectedProviderIdentity: 'provider-row-1' },
    );

    expect(aiProviderService.createAiProvider).not.toHaveBeenCalled();
    expect(aiProviderService.updateAiProvider).toHaveBeenCalledWith(
      'example-provider',
      expect.objectContaining({
        name: 'Example Provider',
        settings: {
          defaultShowBrowserRequest: true,
          sdkType: 'openai',
          supportResponsesApi: true,
        },
      }),
    );
    expect(aiProviderService.updateAiProviderConfig).toHaveBeenCalledWith(
      'example-provider',
      expect.objectContaining({
        config: { enableResponseApi: true },
        fetchOnClient: true,
      }),
    );
  });

  it.each(['http://127.0.0.1:11434/v1', 'http://[::1]:11434/v1'])(
    'forces client-side fetches for loopback endpoint %s',
    async (baseURL) => {
      await applyProviderImport(
        {
          ...payload,
          provider: { ...payload.provider, baseURL, fetchOnClient: false },
        },
        {},
      );

      expect(aiProviderService.updateAiProviderConfig).toHaveBeenCalledWith(
        'example-provider',
        expect.objectContaining({ fetchOnClient: true }),
      );
    },
  );

  it('revalidates the imported provider detail and model list caches', async () => {
    await applyProviderImport(payload, {});

    expect(mocks.mutate).toHaveBeenCalledWith([
      AiProviderSwrKey.fetchAiProviderItem,
      'example-provider',
    ]);
    expect(mocks.mutate).toHaveBeenCalledWith(aiModelKeys.list('example-provider'));
  });

  it('refuses to replace a built-in provider', async () => {
    vi.mocked(aiProviderService.getAiProviderById).mockResolvedValue({
      enabled: true,
      id: 'openai',
      identity: 'builtin-row',
      name: 'OpenAI',
      settings: { sdkType: 'openai' },
      source: AiProviderSourceEnum.Builtin,
    });

    await expect(
      applyProviderImport(
        { ...payload, provider: { ...payload.provider, id: 'openai' } },
        { expectedProviderIdentity: 'builtin-row' },
      ),
    ).rejects.toBeInstanceOf(BuiltinProviderImportError);
    expect(aiProviderService.updateAiProvider).not.toHaveBeenCalled();
    expect(aiProviderService.updateAiProviderConfig).not.toHaveBeenCalled();
    expect(aiModelService.batchUpdateAiModels).not.toHaveBeenCalled();
  });

  it('does not overwrite a provider that appeared after the preview', async () => {
    vi.mocked(aiProviderService.getAiProviderById).mockResolvedValue({
      enabled: true,
      id: 'example-provider',
      identity: 'provider-row-2',
      name: 'Existing Provider',
      settings: { sdkType: 'openai' },
      source: AiProviderSourceEnum.Custom,
    });

    await expect(applyProviderImport(payload, {})).rejects.toBeInstanceOf(
      ProviderOverwriteNotConfirmedError,
    );
    expect(aiProviderService.updateAiProvider).not.toHaveBeenCalled();
    expect(aiProviderService.updateAiProviderConfig).not.toHaveBeenCalled();
  });

  it('marks a newly created partial import as safe to retry idempotently', async () => {
    vi.mocked(aiProviderService.getAiProviderById)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        enabled: false,
        id: 'example-provider',
        identity: 'partial-provider-row',
        name: 'Example Provider',
        settings: { sdkType: 'openai' },
        source: AiProviderSourceEnum.Custom,
      });
    vi.mocked(aiProviderService.updateAiProviderConfig).mockRejectedValueOnce(
      new Error('temporary database failure'),
    );

    const firstAttemptError = await applyProviderImport(payload, {}).catch((error) => error);
    expect(firstAttemptError).toBeInstanceOf(PartialProviderImportError);
    expect(firstAttemptError).toMatchObject({ providerIdentity: 'partial-provider-row' });

    vi.mocked(aiProviderService.getAiProviderById).mockResolvedValue({
      enabled: false,
      id: 'example-provider',
      identity: 'partial-provider-row',
      name: 'Example Provider',
      settings: { sdkType: 'openai' },
      source: AiProviderSourceEnum.Custom,
    });

    await expect(
      applyProviderImport(payload, { expectedProviderIdentity: 'partial-provider-row' }),
    ).resolves.toBeUndefined();
    expect(aiProviderService.updateAiProviderConfig).toHaveBeenCalledTimes(2);
    expect(aiModelService.batchUpdateAiModels).toHaveBeenCalledTimes(1);
  });

  it('refuses overwrite consent when the provider ID now belongs to another row', async () => {
    vi.mocked(aiProviderService.getAiProviderById).mockResolvedValue({
      enabled: true,
      id: 'example-provider',
      identity: 'replacement-provider-row',
      name: 'Replacement Provider',
      settings: { sdkType: 'openai' },
      source: AiProviderSourceEnum.Custom,
    });

    await expect(
      applyProviderImport(payload, { expectedProviderIdentity: 'reviewed-provider-row' }),
    ).rejects.toBeInstanceOf(ProviderOverwriteNotConfirmedError);
    expect(aiProviderService.updateAiProvider).not.toHaveBeenCalled();
  });

  it('rolls back an existing provider when a later import step fails', async () => {
    vi.mocked(aiProviderService.getAiProviderById).mockResolvedValue({
      checkModel: 'old/model',
      config: { enableResponseApi: true },
      description: 'Old description',
      enabled: false,
      fetchOnClient: true,
      id: 'example-provider',
      identity: 'existing-provider-row',
      keyVaults: { apiKey: 'old-secret', baseURL: 'https://old.example.com/v1' },
      logo: 'https://old.example.com/logo.png',
      name: 'Existing Provider',
      settings: { sdkType: 'openai' },
      source: AiProviderSourceEnum.Custom,
    } as AiProviderDetailItem);
    vi.mocked(aiModelService.batchUpdateAiModels).mockRejectedValueOnce(
      new Error('temporary database failure'),
    );

    const error = await applyProviderImport(payload, {
      expectedProviderIdentity: 'existing-provider-row',
    }).catch((cause) => cause);

    expect(error).toMatchObject({ message: 'temporary database failure' });
    expect(error).not.toBeInstanceOf(PartialProviderImportError);
    expect(aiProviderService.updateAiProvider).toHaveBeenLastCalledWith('example-provider', {
      description: 'Old description',
      logo: 'https://old.example.com/logo.png',
      name: 'Existing Provider',
      settings: { sdkType: 'openai' },
    });
    expect(aiProviderService.updateAiProviderConfig).toHaveBeenLastCalledWith('example-provider', {
      checkModel: 'old/model',
      config: { enableResponseApi: true },
      fetchOnClient: true,
      keyVaults: { apiKey: 'old-secret', baseURL: 'https://old.example.com/v1' },
    });
    expect(aiProviderService.toggleProviderEnabled).toHaveBeenLastCalledWith(
      'example-provider',
      false,
    );
  });

  it('surfaces a partial overwrite when restoring the previous provider fails', async () => {
    vi.mocked(aiProviderService.getAiProviderById).mockResolvedValue({
      enabled: true,
      id: 'example-provider',
      identity: 'existing-provider-row',
      name: 'Existing Provider',
      settings: { sdkType: 'openai' },
      source: AiProviderSourceEnum.Custom,
    });
    vi.mocked(aiProviderService.updateAiProvider)
      .mockResolvedValueOnce(emptyQueryResult)
      .mockRejectedValueOnce(new Error('restore failed'));
    vi.mocked(aiModelService.batchUpdateAiModels).mockRejectedValueOnce(
      new Error('temporary database failure'),
    );

    const error = await applyProviderImport(payload, {
      expectedProviderIdentity: 'existing-provider-row',
    }).catch((cause) => cause);

    expect(error).toBeInstanceOf(PartialProviderImportError);
    expect(error).toMatchObject({ providerIdentity: 'existing-provider-row' });
  });

  it('does not roll back after provider writes have already succeeded', async () => {
    vi.mocked(aiProviderService.getAiProviderById).mockResolvedValue({
      enabled: true,
      id: 'example-provider',
      identity: 'existing-provider-row',
      name: 'Existing Provider',
      settings: { sdkType: 'openai' },
      source: AiProviderSourceEnum.Custom,
    });
    mocks.mutate.mockRejectedValueOnce(new Error('cache revalidation failed'));

    await expect(
      applyProviderImport(payload, { expectedProviderIdentity: 'existing-provider-row' }),
    ).rejects.toThrow('cache revalidation failed');
    expect(aiProviderService.updateAiProvider).toHaveBeenCalledTimes(1);
    expect(aiProviderService.toggleProviderEnabled).toHaveBeenCalledTimes(1);
  });
});
