import { describe, expect, it, vi } from 'vitest';

import { getAppConfig } from '@/envs/app';
import { type SystemEmbeddingConfig } from '@/types/knowledgeBase';
import { type FilesConfigItem } from '@/types/user/settings/filesConfig';

import { getServerDefaultAgentConfig, getServerDefaultFilesConfig } from './index';
import { parseAgentConfig } from './parseDefaultAgent';
import { parseFilesConfig } from './parseFilesConfig';

vi.mock('@/envs/app', () => ({
  getAppConfig: vi.fn(),
}));

vi.mock('@/envs/knowledge', () => ({
  knowledgeEnv: {
    DEFAULT_FILES_CONFIG: 'test_config',
  },
}));

vi.mock('./parseDefaultAgent', () => ({
  parseAgentConfig: vi.fn(),
}));

vi.mock('./parseFilesConfig', () => ({
  parseFilesConfig: vi.fn(),
}));

describe('getServerDefaultAgentConfig', () => {
  it('should return parsed agent config', () => {
    const mockConfig = { key: 'value' };
    vi.mocked(getAppConfig).mockReturnValue({
      DEFAULT_AGENT_CONFIG: 'test_agent_config',
    } as any);
    vi.mocked(parseAgentConfig).mockReturnValue(mockConfig);

    const result = getServerDefaultAgentConfig();

    expect(parseAgentConfig).toHaveBeenCalledWith('test_agent_config');
    expect(result).toEqual(mockConfig);
  });

  it('should return empty object if parseAgentConfig returns undefined', () => {
    vi.mocked(getAppConfig).mockReturnValue({
      DEFAULT_AGENT_CONFIG: 'test_agent_config',
    } as any);
    vi.mocked(parseAgentConfig).mockReturnValue(undefined);

    const result = getServerDefaultAgentConfig();

    expect(result).toEqual({});
  });
});

describe('getServerDefaultFilesConfig', () => {
  it('should return parsed files config', () => {
    const mockEmbeddingModel: FilesConfigItem = {
      model: 'test-model',
      provider: 'test-provider',
    };

    const mockRerankerModel: FilesConfigItem = {
      model: 'test-reranker',
      provider: 'test-provider',
    };

    const mockConfig: SystemEmbeddingConfig = {
      embeddingModel: mockEmbeddingModel,
      queryMode: 'hybrid',
      rerankerModel: mockRerankerModel,
    };

    vi.mocked(parseFilesConfig).mockReturnValue(mockConfig);

    const result = getServerDefaultFilesConfig();

    expect(parseFilesConfig).toHaveBeenCalledWith('test_config');
    expect(result).toEqual(mockConfig);
  });
});
