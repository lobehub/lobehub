// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const multimodalEnvKeys = [
  'MULTIMODAL_UNDERSTANDING_IMAGE_FORMATS',
  'MULTIMODAL_UNDERSTANDING_MODEL',
  'MULTIMODAL_UNDERSTANDING_PROVIDER',
  'VISUAL_UNDERSTANDING_MODEL',
  'VISUAL_UNDERSTANDING_PROVIDER',
  'CRAWLER_IMPLS',
  'SEARCH_PROVIDERS',
];

describe('getToolsConfig', () => {
  beforeEach(() => {
    vi.resetModules();
    for (const key of multimodalEnvKeys) delete process.env[key];
  });

  afterEach(() => {
    for (const key of multimodalEnvKeys) delete process.env[key];
  });

  it('should use safe default image formats for multimodal understanding', async () => {
    const { getToolsConfig } = await import('../tools');
    const config = getToolsConfig();

    expect(config.MULTIMODAL_UNDERSTANDING_IMAGE_FORMATS).toEqual(['image/jpeg', 'image/png']);
  });

  it('should normalize configured multimodal image formats', async () => {
    process.env.MULTIMODAL_UNDERSTANDING_IMAGE_FORMATS = ' png, image/jpeg, jpg, image/webp, PNG ';

    const { getToolsConfig } = await import('../tools');
    const config = getToolsConfig();

    expect(config.MULTIMODAL_UNDERSTANDING_IMAGE_FORMATS).toEqual([
      'image/png',
      'image/jpeg',
      'image/webp',
    ]);
  });

  it('should default id lists to empty arrays', async () => {
    const { getToolsConfig } = await import('../tools');
    const config = getToolsConfig();

    expect(config.SEARCH_PROVIDERS).toEqual([]);
    expect(config.CRAWLER_IMPLS).toEqual([]);
  });

  it.each([
    ['quotes kept by Compose list syntax', "'searxng'", ['searxng']],
    ['double quotes around the whole list', '"tavily,brave"', ['tavily', 'brave']],
    ['zero-width space from a copied value', ' \u200Bsearxng', ['searxng']],
    ['BOM and trailing zero-width joiner', '\uFEFFsearxng\u200D', ['searxng']],
    ['uppercase and full-width commas', 'Tavily，BRAVE', ['tavily', 'brave']],
    ['padded entries and empty items', '  tavily  ,, brave  ', ['tavily', 'brave']],
  ])('should normalize SEARCH_PROVIDERS with %s', async (_, value, expected) => {
    process.env.SEARCH_PROVIDERS = value;

    const { getToolsConfig } = await import('../tools');

    expect(getToolsConfig().SEARCH_PROVIDERS).toEqual(expected);
  });

  it('should keep unknown ids for the consumer to validate', async () => {
    process.env.CRAWLER_IMPLS = "'jina', not-a-crawler";

    const { getToolsConfig } = await import('../tools');

    expect(getToolsConfig().CRAWLER_IMPLS).toEqual(['jina', 'not-a-crawler']);
  });

  it('should expose legacy visual understanding variables through the multimodal config', async () => {
    process.env.VISUAL_UNDERSTANDING_MODEL = 'legacy-model';
    process.env.VISUAL_UNDERSTANDING_PROVIDER = 'legacy-provider';

    const { getToolsConfig } = await import('../tools');
    const config = getToolsConfig();

    expect(config.MULTIMODAL_UNDERSTANDING_MODEL).toBe('legacy-model');
    expect(config.MULTIMODAL_UNDERSTANDING_PROVIDER).toBe('legacy-provider');
  });

  it('should prefer canonical multimodal variables over legacy variables', async () => {
    process.env.MULTIMODAL_UNDERSTANDING_MODEL = 'canonical-model';
    process.env.MULTIMODAL_UNDERSTANDING_PROVIDER = 'canonical-provider';
    process.env.VISUAL_UNDERSTANDING_MODEL = 'legacy-model';
    process.env.VISUAL_UNDERSTANDING_PROVIDER = 'legacy-provider';

    const { getToolsConfig } = await import('../tools');
    const config = getToolsConfig();

    expect(config.MULTIMODAL_UNDERSTANDING_MODEL).toBe('canonical-model');
    expect(config.MULTIMODAL_UNDERSTANDING_PROVIDER).toBe('canonical-provider');
  });
});
