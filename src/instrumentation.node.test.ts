// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ register: vi.fn(), processor: vi.fn() }));
vi.mock('@lobechat/observability-otel/node', () => ({ register: mocks.register }));
vi.mock('@/libs/traces', () => ({ getLangfuseSpanProcessor: mocks.processor }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('shared OpenTelemetry registration', () => {
  it.each([
    ['production', '', '', false],
    ['development', '1', '', false],
    ['development', '1', '1', true],
    ['production', '1', '', true],
  ])(
    'registers Langfuse with operational telemetry=%s/%s/%s',
    async (env, enabled, inDev, expected) => {
      vi.stubEnv('NODE_ENV', env);
      vi.stubEnv('ENABLE_TELEMETRY', enabled);
      vi.stubEnv('ENABLE_TELEMETRY_IN_DEV', inDev);
      const processor = { forceFlush: vi.fn() };
      mocks.processor.mockReturnValue(processor);
      await import('./instrumentation.node');
      expect(mocks.register).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          autoInstrumentations: expected,
          otlp: expected,
          spanProcessors: [processor],
        }),
      );
    },
  );

  it('retains operational telemetry without a Langfuse processor when disabled', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ENABLE_TELEMETRY', '1');
    mocks.processor.mockReturnValue(undefined);
    await import('./instrumentation.node');
    expect(mocks.register).toHaveBeenCalledWith(
      expect.objectContaining({ otlp: true, spanProcessors: [] }),
    );
  });
});
