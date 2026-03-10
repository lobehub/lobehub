import { vi } from 'vitest';

/**
 * Create a mock Response object for crawler tests.
 * Uses `vi.fn()` for `json`, `text`, and `clone` so individual tests can override them.
 */
export const createMockResponse = (
  body: any,
  opts: { ok: boolean; status?: number; statusText?: string } = { ok: true },
) => {
  const self: any = {
    ok: opts.ok,
    status: opts.status ?? (opts.ok ? 200 : 500),
    statusText: opts.statusText ?? (opts.ok ? 'OK' : 'Internal Server Error'),
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
    clone: vi.fn(),
  };
  self.clone.mockReturnValue({
    ...self,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
  });
  return self;
};
