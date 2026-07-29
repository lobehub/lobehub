// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { params } from './index';

const resolveRouters = (model?: string) =>
  params.routers({ apiKey: 'test' }, { model }) as Array<{
    apiType: string;
    models?: string[];
    options: { baseURL?: string; sdkType?: string };
  }>;

describe('OpenCodeZen routers', () => {
  it('should route DeepSeek-family models to the deepseek runtime', () => {
    // The generic openai fallback sends response_format json_schema for
    // structured output, which DeepSeek upstreams reject — the deepseek
    // runtime simulates it via tool calling instead.
    const routers = resolveRouters('deepseek-v4-flash');
    const deepseekRouter = routers.find((router) => router.apiType === 'deepseek');

    expect(deepseekRouter?.models).toContain('deepseek-v4-flash');
    expect(deepseekRouter?.options.sdkType).toBe('openai');
  });

  it('should match gateway-specific DeepSeek ids missing from the static model list', () => {
    const routers = resolveRouters('deepseek-v4-flash-free');
    const deepseekRouter = routers.find((router) => router.apiType === 'deepseek');

    expect(deepseekRouter?.models).toContain('deepseek-v4-flash-free');
  });

  it('should keep the openai catch-all as the last router', () => {
    const routers = resolveRouters('some-unknown-model');

    expect(routers.at(-1)?.apiType).toBe('openai');
    expect(routers.at(-1)?.models).toBeUndefined();
  });
});
