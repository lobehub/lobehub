// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const multimodalEnvKeys = [
  'MULTIMODAL_UNDERSTANDING_MODEL',
  'MULTIMODAL_UNDERSTANDING_PROVIDER',
  'VISUAL_UNDERSTANDING_MODEL',
  'VISUAL_UNDERSTANDING_PROVIDER',
];

describe('getToolsConfig', () => {
  beforeEach(() => {
    vi.resetModules();
    for (const key of multimodalEnvKeys) delete process.env[key];
  });

  afterEach(() => {
    for (const key of multimodalEnvKeys) delete process.env[key];
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
