import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getMeter: vi.fn() }));

vi.mock('@opentelemetry/api', () => ({
  diag: { error: vi.fn() },
  metrics: { getMeter: mocks.getMeter },
  SpanStatusCode: { ERROR: 2, OK: 1 },
  trace: { getTracer: vi.fn(() => ({ startActiveSpan: vi.fn() })) },
}));

describe('full-text search reindex metric initialization', () => {
  /** The dynamic import competes with package-wide transforms during the unified repository check. */
  it('does not bind instruments while the CLI imports the module before registration', async () => {
    expect(mocks.getMeter).not.toHaveBeenCalled();

    await import('.');

    expect(mocks.getMeter).not.toHaveBeenCalled();
  }, 15_000);
});
