import { describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';

import { aiModelListResource, aiModelReasoningConfigResource } from './projection';

describe('aiModelReasoningConfigResource scope', () => {
  it('is partitioned by identity only, so a workspace switch keeps the same rows', () => {
    const get = vi.spyOn(cacheScope, 'get').mockReturnValue('user-1:workspace-a');
    const personal = aiModelReasoningConfigResource.scope.get();

    get.mockReturnValue('user-1:workspace-b');
    expect(aiModelReasoningConfigResource.scope.get()).toBe(personal);
    expect(personal).toBe('user-1:*');

    get.mockReturnValue('user-2:workspace-a');
    expect(aiModelReasoningConfigResource.scope.get()).not.toBe(personal);

    vi.restoreAllMocks();
  });

  it('keeps the model list per workspace', () => {
    const get = vi.spyOn(cacheScope, 'get').mockReturnValue('user-1:workspace-a');
    expect(aiModelListResource.scope.get()).toBe('user-1:workspace-a');

    get.mockReturnValue('user-1:workspace-b');
    expect(aiModelListResource.scope.get()).toBe('user-1:workspace-b');

    vi.restoreAllMocks();
  });
});
