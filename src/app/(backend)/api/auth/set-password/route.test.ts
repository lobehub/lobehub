// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSetPassword } = vi.hoisted(() => ({
  mockSetPassword: vi.fn(),
}));

vi.mock('@/auth', () => ({
  auth: {
    api: {
      setPassword: mockSetPassword,
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/auth/set-password', () => {
  it('delegates to better auth server api', async () => {
    mockSetPassword.mockResolvedValueOnce({ status: true });

    const { POST } = await import('./route');
    const req = new Request('http://localhost/api/auth/set-password', {
      body: JSON.stringify({ newPassword: 'abc12345' }),
      headers: {
        'Content-Type': 'application/json',
        'cookie': 'better-auth.session_token=test-token',
      },
      method: 'POST',
    });

    const res = await POST(req);

    expect(mockSetPassword).toHaveBeenCalledWith({
      body: { newPassword: 'abc12345' },
      headers: req.headers,
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: true });
  });

  it('returns a 400 response when better auth rejects', async () => {
    mockSetPassword.mockRejectedValueOnce({
      message: 'user already has a password',
      status: 400,
    });

    const { POST } = await import('./route');
    const req = new Request('http://localhost/api/auth/set-password', {
      body: JSON.stringify({ newPassword: 'abc12345' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ message: 'user already has a password' });
  });
});
