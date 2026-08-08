import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SkillStoreExecutionRuntime, type SkillStoreRuntimeService } from './index';

const importResult = { skill: { id: 's1', name: 'My Skill' }, status: 'created' as const };

const createService = (): SkillStoreRuntimeService => ({
  importFromGitHub: vi.fn().mockResolvedValue(importResult),
  importFromMarket: vi.fn().mockResolvedValue(importResult),
  importFromUrl: vi.fn().mockResolvedValue(importResult),
  importFromZipUrl: vi.fn().mockResolvedValue(importResult),
  onSkillImported: vi.fn().mockResolvedValue(undefined),
  searchSkill: vi.fn(),
});

describe('SkillStoreExecutionRuntime — direct/local invoke refresh', () => {
  let service: SkillStoreRuntimeService;
  let runtime: SkillStoreExecutionRuntime;

  beforeEach(() => {
    service = createService();
    runtime = new SkillStoreExecutionRuntime({ service });
  });

  it('refreshes the skills list inline after a successful importSkill', async () => {
    const result = await runtime.importSkill({ type: 'url', url: 'https://example.com/skill' });

    expect(result.success).toBe(true);
    expect(service.onSkillImported).toHaveBeenCalledTimes(1);
  });

  it('refreshes the skills list inline after a successful importFromMarket', async () => {
    const result = await runtime.importFromMarket({ identifier: 'cool-skill' });

    expect(result.success).toBe(true);
    expect(service.onSkillImported).toHaveBeenCalledTimes(1);
  });

  it('does not refresh when the import throws', async () => {
    (service.importFromUrl as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));

    const result = await runtime.importSkill({ type: 'url', url: 'https://example.com/skill' });

    expect(result.success).toBe(false);
    expect(service.onSkillImported).not.toHaveBeenCalled();
  });

  it('does not refresh for searchSkill', async () => {
    (service.searchSkill as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: [],
      page: 1,
      pageSize: 10,
      total: 0,
    });

    await runtime.searchSkill({ q: 'anything' });

    expect(service.onSkillImported).not.toHaveBeenCalled();
  });
});
