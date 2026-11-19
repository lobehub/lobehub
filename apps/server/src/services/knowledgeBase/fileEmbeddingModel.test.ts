// @vitest-environment node
import { DEFAULT_FILE_EMBEDDING_MODEL_ITEM } from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserModel } from '@/database/models/user';
import { getServerDefaultFilesConfig } from '@/server/globalConfig';

import { resolveFileEmbeddingModel } from './fileEmbeddingModel';

vi.mock('@/database/models/user', () => ({ UserModel: vi.fn() }));
vi.mock('@/server/globalConfig', () => ({ getServerDefaultFilesConfig: vi.fn() }));

const serverDB = {} as any;

const withSettings = (systemAgent?: Record<string, unknown>) => {
  const getUserSettings = vi.fn().mockResolvedValue(systemAgent ? { systemAgent } : undefined);
  vi.mocked(UserModel).mockImplementation(function () {
    return { getUserSettings } as any;
  });
};

describe('resolveFileEmbeddingModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerDefaultFilesConfig).mockReturnValue({
      embeddingModel: { model: 'bge-m3', provider: 'ollama' },
    } as any);
  });

  it('uses the model picked in Service Model over DEFAULT_FILES_CONFIG', async () => {
    withSettings({ fileEmbedding: { model: 'text-embedding-3-large', provider: 'azure' } });

    await expect(resolveFileEmbeddingModel(serverDB, 'user-1')).resolves.toEqual({
      model: 'text-embedding-3-large',
      provider: 'azure',
    });
    expect(UserModel).toHaveBeenCalledWith(serverDB, 'user-1');
  });

  it('does not parse DEFAULT_FILES_CONFIG when the user picked a model', async () => {
    withSettings({ fileEmbedding: { model: 'text-embedding-3-large', provider: 'azure' } });
    vi.mocked(getServerDefaultFilesConfig).mockImplementation(() => {
      throw new Error('Invalid environment variable format.');
    });

    await expect(resolveFileEmbeddingModel(serverDB, 'user-1')).resolves.toEqual({
      model: 'text-embedding-3-large',
      provider: 'azure',
    });
  });

  it('runs DEFAULT_FILES_CONFIG when nothing is picked, as before the setting existed', async () => {
    withSettings({ topic: { model: 'gpt-4o-mini', provider: 'openai' } });

    await expect(resolveFileEmbeddingModel(serverDB, 'user-1')).resolves.toEqual({
      model: 'bge-m3',
      provider: 'ollama',
    });
  });

  it('uses the same default for two members of a workspace with different personal picks', async () => {
    withSettings({ fileEmbedding: { model: 'text-embedding-3-large', provider: 'azure' } });
    const indexingModel = await resolveFileEmbeddingModel(serverDB, 'uploader', 'workspace-1');

    withSettings({ fileEmbedding: { model: 'text-embedding-3-small', provider: 'openai' } });
    const searchModel = await resolveFileEmbeddingModel(serverDB, 'searcher', 'workspace-1');

    expect(indexingModel).toEqual({ model: 'bge-m3', provider: 'ollama' });
    expect(searchModel).toEqual(indexingModel);
  });

  it('ignores a half-set pick', async () => {
    withSettings({ fileEmbedding: { model: 'text-embedding-3-large' } });

    await expect(resolveFileEmbeddingModel(serverDB, 'user-1')).resolves.toEqual({
      model: 'bge-m3',
      provider: 'ollama',
    });
  });

  it('falls back to the code default without settings or an embedding_model entry', async () => {
    withSettings();
    vi.mocked(getServerDefaultFilesConfig).mockReturnValue({ queryMode: 'full_text' } as any);

    await expect(resolveFileEmbeddingModel(serverDB, 'user-1')).resolves.toEqual(
      DEFAULT_FILE_EMBEDDING_MODEL_ITEM,
    );
  });

  it('keeps failing on an invalid DEFAULT_FILES_CONFIG when nothing is picked', async () => {
    withSettings();
    vi.mocked(getServerDefaultFilesConfig).mockImplementation(() => {
      throw new Error('Invalid environment variable format.');
    });

    await expect(resolveFileEmbeddingModel(serverDB, 'user-1')).rejects.toThrow(
      'Invalid environment variable format.',
    );
  });
});
