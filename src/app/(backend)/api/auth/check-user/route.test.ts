import { beforeEach, describe, expect, it, vi } from 'vitest';

import { consumeCheckUserRateLimit } from './rateLimit';
import { POST } from './route';

const { mockLimit, mockSelect, mockFrom, mockWhere } = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockWhere = vi.fn(() => ({ limit: mockLimit }));
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  return { mockFrom, mockLimit, mockSelect, mockWhere };
});

vi.mock('@/database/server', () => ({
  serverDB: {
    select: mockSelect,
  },
}));

vi.mock('@/database/schemas/user', () => ({
  users: { email: 'email', id: 'id' },
}));

vi.mock('./rateLimit', () => ({
  consumeCheckUserRateLimit: vi.fn(() => true),
}));

describe('POST /api/auth/check-user (AUTH-001)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(consumeCheckUserRateLimit).mockReturnValue(true);
  });

  const post = (body: unknown, headers?: HeadersInit) =>
    POST(
      new Request('https://example.com/api/auth/check-user', {
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json', ...headers },
        method: 'POST',
      }) as never,
    );

  it('returns exists without hasPassword when the user is found', async () => {
    mockLimit.mockResolvedValueOnce([{ id: 'user-1' }]);

    const res = await post({ email: 'User@Example.com' });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ exists: true });
    expect(json).not.toHaveProperty('hasPassword');
  });

  it('returns exists:false without hasPassword when the user is missing', async () => {
    mockLimit.mockResolvedValueOnce([]);

    const res = await post({ email: 'missing@example.com' });
    const json = await res.json();

    expect(json).toEqual({ exists: false });
    expect(json).not.toHaveProperty('hasPassword');
  });

  it('returns 429 when the rate limit is exceeded', async () => {
    vi.mocked(consumeCheckUserRateLimit).mockReturnValueOnce(false);

    const res = await post({ email: 'user@example.com' }, { 'x-forwarded-for': '203.0.113.10' });
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.exists).toBe(false);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('rate-limits using the first x-forwarded-for hop', async () => {
    mockLimit.mockResolvedValueOnce([]);

    await post({ email: 'a@example.com' }, { 'x-forwarded-for': '198.51.100.1, 10.0.0.1' });

    expect(consumeCheckUserRateLimit).toHaveBeenCalledWith('198.51.100.1');
  });
});
