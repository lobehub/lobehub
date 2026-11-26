import bcrypt from 'bcryptjs';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { seedTestUser, TEST_USER } from './seedTestUser';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('pg', () => ({
  default: {
    Client: class {
      connect = vi.fn();
      end = vi.fn();
      query = query;
    },
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('seedTestUser', () => {
  it('seeds credentials that can sign in through Better Auth', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://localhost/e2e-fixture');
    await seedTestUser();

    const userValues = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO users'))![1];
    const accountValues = query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO accounts'),
    )![1];
    const db = {
      account: [
        {
          accountId: accountValues[2],
          createdAt: new Date(accountValues[5]),
          id: accountValues[0],
          password: accountValues[4],
          providerId: accountValues[3],
          updatedAt: new Date(accountValues[5]),
          userId: accountValues[1],
        },
      ],
      session: [],
      user: [
        {
          createdAt: new Date(userValues[7]),
          email: userValues[1],
          emailVerified: userValues[5],
          id: userValues[0],
          name: userValues[4],
          updatedAt: new Date(userValues[7]),
        },
      ],
      verification: [],
    };
    const auth = betterAuth({
      baseURL: 'http://localhost:3006',
      database: memoryAdapter(db),
      emailAndPassword: {
        enabled: true,
        password: { verify: ({ hash, password }) => bcrypt.compare(password, hash) },
      },
      secret: 'test-secret-test-secret-test-secret',
    });

    const response = await auth.handler(
      new Request('http://localhost:3006/api/auth/sign-in/email', {
        body: JSON.stringify({ email: TEST_USER.email, password: TEST_USER.password }),
        headers: { 'content-type': 'application/json', 'origin': 'http://localhost:3006' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user: { id: TEST_USER.id } });
    expect(response.headers.get('set-cookie')).toContain('better-auth.session_token');
  });
});
