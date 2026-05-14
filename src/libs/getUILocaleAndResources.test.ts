import { describe, expect, it, vi } from 'vitest';

import { getUILocaleAndResources } from './getUILocaleAndResources';

describe('getUILocaleAndResources', () => {
  it('should return te-IN locale and resources for te-IN', async () => {
    const result = await getUILocaleAndResources('te-IN');
    expect(result.locale).toBe('te-IN');
    expect(result.resources).toBeDefined();
  });

  it('should return en-US locale and en resources for en-US', async () => {
    const result = await getUILocaleAndResources('en-US');
    expect(result.locale).toBe('en-US');
    expect(result.resources).toBeDefined();
  });

  it('should return en-US locale and en resources for en', async () => {
    const result = await getUILocaleAndResources('en');
    expect(result.locale).toBe('en-US');
    expect(result.resources).toBeDefined();
  });

  it('should return en-US locale and en resources for auto', async () => {
    const result = await getUILocaleAndResources('auto');
    expect(result.locale).toBe('en-US');
    expect(result.resources).toBeDefined();
  });

  it('should return ar locale and custom resources for ar', async () => {
    const result = await getUILocaleAndResources('ar');
    expect(result.locale).toBe('ar');
    expect(result.resources).toBeDefined();
  });

  it('should return de-DE locale and custom resources for de-DE', async () => {
    const result = await getUILocaleAndResources('de-DE');
    expect(result.locale).toBe('de-DE');
    expect(result.resources).toBeDefined();
  });

  it('should return es-ES locale and custom resources for es-ES', async () => {
    const result = await getUILocaleAndResources('es-ES');
    expect(result.locale).toBe('es-ES');
    expect(result.resources).toBeDefined();
  });

  it('should fallback to @lobehub/ui builtin resources if business ui.json is missing', async () => {
    vi.resetModules();
    vi.doMock('@/../locales/en-US/ui.json', () => ({ default: null }));

    const { getUILocaleAndResources: getWithFallback } = await import('./getUILocaleAndResources');
    const result = await getWithFallback('unknown-locale');
    expect(result.locale).toBe('en-US');
    expect(result.resources).toBeDefined();
  });
});
