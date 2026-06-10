import { describe, expect, it } from 'vitest';

import { AiInfraRepos } from '../index';

describe('AiInfraRepos constructor', () => {
  it('passes workspaceId to provider and model models', () => {
    const repo = new AiInfraRepos({} as any, 'user-1', {}, 'workspace-1');

    expect((repo.aiProviderModel as any).workspaceId).toBe('workspace-1');
    expect((repo.aiModelModel as any).workspaceId).toBe('workspace-1');
  });
});
