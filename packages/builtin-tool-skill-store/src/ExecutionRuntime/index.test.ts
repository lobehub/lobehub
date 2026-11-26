import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SkillStoreManifest } from '../manifest';
import type { MarketSkillItem } from '../types';
import { SkillStoreExecutionRuntime, type SkillStoreRuntimeService } from './index';

const importResult = { skill: { id: 's1', name: 'My Skill' }, status: 'created' as const };

const createSkillItem = (overrides: Partial<MarketSkillItem> = {}): MarketSkillItem => ({
  createdAt: '2026-01-01T00:00:00Z',
  description: 'Full description of the skill',
  identifier: 'market-pptx',
  installCount: 42,
  name: 'pptx',
  repository: 'https://github.com/example/skills',
  updatedAt: '2026-01-02T00:00:00Z',
  ...overrides,
});

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

  it('includes skill description in importSkill and importFromMarket results when provided', async () => {
    const withDesc = {
      skill: { description: 'Formats executive decision memos.', id: 's2', name: 'q4-helper' },
      status: 'created' as const,
    };
    (service.importFromUrl as ReturnType<typeof vi.fn>).mockResolvedValueOnce(withDesc);
    (service.importFromMarket as ReturnType<typeof vi.fn>).mockResolvedValueOnce(withDesc);

    const urlResult = await runtime.importSkill({
      type: 'url',
      url: 'https://example.com/SKILL.md',
    });
    expect(urlResult.content).toBe(
      'Skill "q4-helper" created successfully.\nDescription: Formats executive decision memos.',
    );
    expect(urlResult.state).toEqual({
      description: 'Formats executive decision memos.',
      name: 'q4-helper',
      skillId: 's2',
      status: 'created',
      success: true,
    });

    const marketResult = await runtime.importFromMarket({ identifier: 'market-q4-helper' });
    expect(marketResult.content).toBe(
      'Skill "q4-helper" created successfully from market.\nDescription: Formats executive decision memos.',
    );
    expect(marketResult.state).toEqual({
      description: 'Formats executive decision memos.',
      name: 'q4-helper',
      skillId: 's2',
      status: 'created',
      success: true,
    });
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

describe('SkillStoreExecutionRuntime.searchSkill', () => {
  let service: SkillStoreRuntimeService;
  let runtime: SkillStoreExecutionRuntime;

  beforeEach(() => {
    service = createService();
    runtime = new SkillStoreExecutionRuntime({ service });
  });

  it('exposes `query` (not `q`) in SkillStoreManifest for searchSkill', () => {
    const searchApi = SkillStoreManifest.api.find((api) => api.name === 'searchSkill');
    const properties = searchApi?.parameters.properties ?? {};

    expect(properties).toHaveProperty('query');
    expect(properties).not.toHaveProperty('q');
  });

  it('maps `query` to backend `q`, defaults pageSize to 10, strips unknown keys, and echoes the query', async () => {
    (service.searchSkill as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: [createSkillItem()],
      page: 1,
      pageSize: 10,
      total: 12,
    });

    const result = await runtime.searchSkill({
      extra: 'ignored',
      query: '  pptx  ',
      sort: 'installCount',
    } as any);

    expect(service.searchSkill).toHaveBeenCalledWith({
      pageSize: 10,
      q: 'pptx',
      sort: 'installCount',
    });
    expect(result.success).toBe(true);
    expect(result.content).toContain('Found 12 skills for "pptx" (page 1/2):');
  });

  it('keeps backward compatibility with legacy `q` calls and prefers `query` when both are set', async () => {
    (service.searchSkill as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        items: [createSkillItem()],
        page: 1,
        pageSize: 10,
        total: 1,
      })
      .mockResolvedValueOnce({
        items: [createSkillItem()],
        page: 1,
        pageSize: 5,
        total: 1,
      });

    await runtime.searchSkill({ q: 'find-skills' });
    expect(service.searchSkill).toHaveBeenNthCalledWith(1, {
      pageSize: 10,
      q: 'find-skills',
    });

    await runtime.searchSkill({ pageSize: 5, q: 'legacy', query: 'preferred' });
    expect(service.searchSkill).toHaveBeenNthCalledWith(2, {
      pageSize: 5,
      q: 'preferred',
    });
  });

  it('falls back to browse mode and marks header explicitly when query is omitted or blank', async () => {
    (service.searchSkill as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: [createSkillItem()],
      page: 1,
      pageSize: 10,
      total: 100,
    });

    const result = await runtime.searchSkill({ pageSize: 0, query: '   ' });

    expect(service.searchSkill).toHaveBeenCalledWith({ pageSize: 10 });
    expect(result.content).toContain('Found 100 skills (browse mode, no query, page 1/10):');
  });

  it('echoes resolved `query` in empty-result responses', async () => {
    (service.searchSkill as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: [],
      page: 1,
      pageSize: 10,
      total: 0,
    });

    const result = await runtime.searchSkill({ query: 'nonexistent' });

    expect(result.success).toBe(true);
    expect(result.content).toBe('No skills found matching "nonexistent"');
  });

  it('uses summary instead of duplicating description and truncates overly long text', async () => {
    const longDescription = `${'A'.repeat(350)} tail`;
    (service.searchSkill as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: [
        createSkillItem({
          description: 'Verbose description that should not be duplicated',
          identifier: 'skill-with-summary',
          name: 'with-summary',
          summary: 'Concise summary text',
        }),
        createSkillItem({
          description: longDescription,
          identifier: 'skill-long-desc',
          name: 'long-desc',
          summary: '   ',
        }),
      ],
      page: 1,
      pageSize: 10,
      total: 2,
    });

    const result = await runtime.searchSkill({ query: 'skill' });

    expect(result.content).toContain('Concise summary text');
    expect(result.content).not.toContain('Verbose description that should not be duplicated');
    expect(result.content).toContain(`${'A'.repeat(299)}…`);
    expect(result.content).not.toContain('tail');
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
      apiKeyNames: ['SN_API_KEY', 'SN_VISION_API_KEY'],
      credentials: [
        {
          alternatives: ['SN_VISION_API_KEY'],
          defaultValue: null,
          files: ['SKILL.md', 'scripts/caption.py'],
          hasDefault: false,
          name: 'SN_API_KEY',
          requirement: 'one_of',
        },
        {
          alternatives: ['SN_API_KEY'],
          defaultValue: null,
          files: ['scripts/caption.py'],
          hasDefault: false,
          name: 'SN_VISION_API_KEY',
          requirement: 'one_of',
        },
      ],
      dataEgress: {
        configurableVia: [],
        contentTypes: ['unknown'],
        occurs: true,
        signals: [],
        targets: ['token.sensenova.cn'],
      },
      endpoints: [{ files: ['scripts/caption.py'], host: 'token.sensenova.cn' }],
      identifier,
      name: 'sn-da-image-caption',
      requiresApiKey: true,
      scripts: ['scripts/caption.py'],
      settings: [
        {
          alternatives: [],
          defaultValue: null,
          files: ['scripts/caption.py'],
          hasDefault: false,
          name: 'SN_VISION_MODEL',
          requirement: 'unknown',
        },
      ],
    });
    expect(result.content).toContain('  requiresApiKey: true');
    expect(result.content).toContain('  apiKeyNames: SN_API_KEY, SN_VISION_API_KEY');
    expect(result.content).toContain('  dataEgress.occurs: true');
    expect(result.content).toContain('  dataEgress.targets: token.sensenova.cn');
    expect(result.content).toContain('  dataEgress.contentTypes: unknown');
    // Fallback chains: any one of the keys is enough.
    expect(result.content).toContain('one_of = any one of the alternatives is enough');
    expect(result.content).toContain(
      '  - SN_API_KEY: one_of (or SN_VISION_API_KEY), no default (SKILL.md, scripts/caption.py)',
    );
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
    expect(result.content).toContain('  requiresApiKey: false');
    expect(result.content).toContain('  dataEgress.occurs: false');
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
