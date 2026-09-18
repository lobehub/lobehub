// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ initialized: vi.fn() }));
vi.mock('./instrumentation.node', () => {
  mocks.initialized();
  return {};
});
vi.mock('./libs/debug-file-logger', () => ({}));

beforeEach(() => {
  vi.resetModules();
  vi.doMock('./instrumentation.node', () => {
    mocks.initialized();
    return {};
  });
  vi.clearAllMocks();
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('ENABLE_TELEMETRY', '');
  vi.stubEnv('ENABLE_TELEMETRY_IN_DEV', '');
});

describe('instrumentation enablement', () => {
  it.each([
    ['nodejs', 'production', '1', true],
    ['nodejs', 'development', '1', true],
    ['edge', 'production', '1', false],
    ['nodejs', 'production', '0', false],
  ])('initializes for %s/%s with ENABLE_LANGFUSE=%s', async (runtime, env, enabled, expected) => {
    vi.stubEnv('NEXT_RUNTIME', runtime);
    vi.stubEnv('NODE_ENV', env);
    vi.stubEnv('ENABLE_LANGFUSE', enabled);
    const { register } = await import('./instrumentation');
    await register();
    expect(mocks.initialized).toHaveBeenCalledTimes(expected ? 1 : 0);
  });
});
