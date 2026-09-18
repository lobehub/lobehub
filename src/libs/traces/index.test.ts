// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clientFlush: vi.fn().mockResolvedValue(undefined),
  processorFlush: vi.fn().mockResolvedValue(undefined),
  client: vi.fn(),
  processor: vi.fn(),
}));

vi.mock('@langfuse/client', () => ({
  LangfuseClient: vi.fn(function (options) {
    mocks.client(options);
    return { flush: mocks.clientFlush };
  }),
}));
vi.mock('@langfuse/otel', () => ({
  LangfuseSpanProcessor: vi.fn(function (options) {
    mocks.processor(options);
    return { forceFlush: mocks.processorFlush };
  }),
}));
vi.mock('@lobechat/const', () => ({ CURRENT_VERSION: 'test-release' }));

describe('Langfuse configuration and lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('ENABLE_LANGFUSE', '1');
    vi.stubEnv('LANGFUSE_PUBLIC_KEY', 'pk-test');
    vi.stubEnv('LANGFUSE_SECRET_KEY', 'sk-test');
    vi.stubEnv('LANGFUSE_HOST', 'https://langfuse.example.com');
  });

  it('does not initialize or flush clients when disabled, even without keys', async () => {
    vi.stubEnv('ENABLE_LANGFUSE', '0');
    vi.stubEnv('LANGFUSE_PUBLIC_KEY', '');
    const { getLangfuseClient, getLangfuseSpanProcessor, flushTraces } = await import('./index');
    expect(getLangfuseClient()).toBeUndefined();
    expect(getLangfuseSpanProcessor()).toBeUndefined();
    await flushTraces();
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.processor).not.toHaveBeenCalled();
  });

  it.each(['LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY'])('rejects missing %s', async (key) => {
    vi.stubEnv(key, '');
    const { getLangfuseClient, getLangfuseSpanProcessor } = await import('./index');
    expect(getLangfuseClient).toThrow('NO_LANGFUSE_KEY_ERROR');
    expect(getLangfuseSpanProcessor).toThrow('NO_LANGFUSE_KEY_ERROR');
  });

  it('reuses clients, preserves host/release, and excludes unrelated gen_ai spans', async () => {
    const { getLangfuseClient, getLangfuseSpanProcessor, flushTraces } = await import('./index');
    expect(getLangfuseClient()).toBe(getLangfuseClient());
    expect(getLangfuseSpanProcessor()).toBe(getLangfuseSpanProcessor());
    expect(mocks.client).toHaveBeenCalledExactlyOnceWith({
      baseUrl: 'https://langfuse.example.com',
      publicKey: 'pk-test',
      secretKey: 'sk-test',
    });
    const options = mocks.processor.mock.calls[0][0];
    expect(options.release).toBe('test-release');
    expect(options.baseUrl).toBe('https://langfuse.example.com');
    for (const name of ['http', 'gen_ai', 'openinference', 'langfuse-sdk']) {
      expect(options.shouldExportSpan({ otelSpan: { instrumentationScope: { name } } })).toBe(
        name === 'langfuse-sdk',
      );
    }
    await flushTraces();
    await flushTraces();
    expect(mocks.clientFlush).toHaveBeenCalledTimes(2);
    expect(mocks.processorFlush).toHaveBeenCalledTimes(2);
    expect(mocks.processor).toHaveBeenCalledTimes(1);
  });

  it('keeps W3C IDs and deterministically converts legacy trace IDs', async () => {
    const { getTraceContext } = await import('./index');
    const traceId = '1234567890abcdef1234567890abcdef';
    const observationId = '1234567890abcdef';
    expect(await getTraceContext()).toBeUndefined();
    expect(await getTraceContext(traceId, observationId)).toEqual({
      traceId,
      spanId: observationId,
      traceFlags: 1,
    });
    const legacy = await getTraceContext('legacy-uuid', 'legacy-observation');
    expect(legacy?.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(legacy).toEqual(await getTraceContext('legacy-uuid', 'legacy-observation'));
    expect(legacy?.spanId).toBe('0000000000000001');
  });
});
