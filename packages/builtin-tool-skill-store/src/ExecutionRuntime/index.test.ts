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

describe('SkillStoreExecutionRuntime — searchSkill', () => {
  it('tells the model that descriptions are unverified and points it at inspectSkill', async () => {
    const service = createService();
    (service.searchSkill as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: [
        {
          createdAt: '2026-11-01',
          description: '通过 vision 模型将图片转为文本描述，无需额外配置 API Key。',
          identifier: 'opensensenova-sensenova-skills-sn-da-image-caption',
          installCount: 3,
          name: 'sn-da-image-caption',
          updatedAt: '2026-11-20',
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });

    const result = await new SkillStoreExecutionRuntime({ service }).searchSkill({ q: 'caption' });

    expect(result.success).toBe(true);
    expect(result.content).toContain('无需额外配置 API Key');
    expect(result.content).toContain('Descriptions are written by each skill');
    expect(result.content).toContain('inspectSkill');
  });
});

describe('SkillStoreExecutionRuntime — inspectSkill', () => {
  const identifier = 'opensensenova-sensenova-skills-sn-da-image-caption';

  it('reports the credentials and hosts found in the package, not the description', async () => {
    const service = {
      ...createService(),
      getMarketSkillFiles: vi.fn().mockResolvedValue({
        files: [
          { content: 'Configure via `SN_API_KEY` (minimum required).', path: 'SKILL.md' },
          {
            content: [
              'BASE = "https://token.sensenova.cn/v1"',
              'KEY = os.environ.get("SN_VISION_API_KEY") or os.environ.get("SN_API_KEY")',
              'MODEL = os.environ.get("SN_VISION_MODEL")',
            ].join('\n'),
            path: 'scripts/caption.py',
          },
        ],
        name: 'sn-da-image-caption',
      }),
    };

    const result = await new SkillStoreExecutionRuntime({ service }).inspectSkill({ identifier });

    expect(service.getMarketSkillFiles).toHaveBeenCalledWith(identifier);
    expect(result.success).toBe(true);
    expect(result.state).toEqual({
      credentials: [
        { files: ['SKILL.md', 'scripts/caption.py'], name: 'SN_API_KEY' },
        { files: ['scripts/caption.py'], name: 'SN_VISION_API_KEY' },
      ],
      endpoints: [{ files: ['scripts/caption.py'], host: 'token.sensenova.cn' }],
      identifier,
      name: 'sn-da-image-caption',
      scripts: ['scripts/caption.py'],
      settings: [{ files: ['scripts/caption.py'], name: 'SN_VISION_MODEL' }],
    });
    expect(result.content).toContain('The user has to supply their own');
    // Fallback chains: any one of the keys may be enough.
    expect(result.content).toContain('not every name is necessarily required');
    expect(result.content).toContain('  - SN_API_KEY (SKILL.md, scripts/caption.py)');
    expect(result.content).toContain('  - token.sensenova.cn (scripts/caption.py)');
    expect(result.content).toContain('do not describe the skill as needing no setup');
    // Findings must not read as a complete list.
    expect(result.content).toContain('static check');
    expect(result.content).toContain('Do not present them as exhaustive');
    // Inspecting installs nothing.
    expect(service.importFromMarket).not.toHaveBeenCalled();
    expect(service.onSkillImported).not.toHaveBeenCalled();
  });

  it('says nothing was found, and that the check is static, for a docs-only skill', async () => {
    const service = {
      ...createService(),
      getMarketSkillFiles: vi.fn().mockResolvedValue({
        files: [{ content: 'Summarize the git log.', path: 'SKILL.md' }],
      }),
    };

    const result = await new SkillStoreExecutionRuntime({ service }).inspectSkill({
      identifier: 'release-notes',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('it ships no scripts');
    expect(result.content).toContain('Credentials: none found.');
    expect(result.content).toContain('Network hosts: none written in its scripts.');
    expect(result.content).toContain('static check');
    expect(result.content).not.toContain('Tell the user which credentials');
  });

  it('flags a destination the scripts take from the environment, even with no literal host', async () => {
    const service = {
      ...createService(),
      getMarketSkillFiles: vi.fn().mockResolvedValue({
        files: [
          {
            content: 'requests.post(os.environ["VISION_BASE_URL"] + "/chat", json=payload)',
            path: 'scripts/run.py',
          },
        ],
      }),
    };

    const result = await new SkillStoreExecutionRuntime({ service }).inspectSkill({
      identifier: 'configurable-endpoint',
    });

    expect(result.content).toContain('Network hosts: none written in its scripts.');
    expect(result.content).toContain(
      'Where the scripts send data can also be changed through VISION_BASE_URL.',
    );
    expect(result.content).toContain(
      'Tell the user which credentials it needs and where it sends data',
    );
    expect(result.content).toContain('Do not present them as exhaustive');
  });

  it('fails with the reason when the package cannot be fetched', async () => {
    const service = {
      ...createService(),
      getMarketSkillFiles: vi.fn().mockRejectedValue(new Error('Skill not found')),
    };

    const result = await new SkillStoreExecutionRuntime({ service }).inspectSkill({
      identifier: 'missing',
    });

    expect(result).toEqual({
      content: 'Failed to inspect skill "missing": Skill not found',
      success: false,
    });
  });

  it('is unavailable when the environment cannot fetch market packages', async () => {
    const result = await new SkillStoreExecutionRuntime({ service: createService() }).inspectSkill({
      identifier,
    });

    expect(result.success).toBe(false);
    expect(result.content).toBe('Market skill inspection is not available in this environment.');
  });
});
