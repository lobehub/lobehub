import { afterEach, describe, expect, test, vi } from 'vitest';

describe('User input never appears in SQL queries without parameterization', () => {
  const adversarialInputs = [
    { email: "' OR 1=1 --@example.com", password: 'TestPassword123!' },
    { email: "'; DROP TABLE users; --", password: 'TestPassword123!' },
    { email: 'test@example.com', password: "'; DROP TABLE users; --" },
    { email: "' OR '1'='1'@example.com", password: 'TestPassword123!' },
    { email: 'valid@example.com', password: 'valid-password' },
  ];

  afterEach(() => {
    vi.doUnmock('pg');
  });

  test.each(adversarialInputs)(
    'rejects adversarial input: email=$email',
    async ({ email, password }) => {
      // Reset module registry so TEST_USER picks up the env overrides below
      vi.resetModules();

      const savedEmail = process.env.E2E_TEST_USER_EMAIL;
      const savedPassword = process.env.E2E_TEST_USER_PASSWORD;
      const savedDbUrl = process.env.DATABASE_URL;

      process.env.DATABASE_URL = 'postgresql://test:test@localhost/testdb';
      process.env.E2E_TEST_USER_EMAIL = email;
      process.env.E2E_TEST_USER_PASSWORD = password;

      const queryCalls: Array<{ sql: string; params?: any[] }> = [];

      vi.doMock('pg', () => ({
        default: {
          Client: vi.fn(() => ({
            connect: vi.fn().mockResolvedValue(undefined),
            end: vi.fn().mockResolvedValue(undefined),
            query: vi.fn().mockImplementation((sql: string, params?: any[]) => {
              queryCalls.push({ sql, params });
              return Promise.resolve({ rows: [], rowCount: 1 });
            }),
          })),
        },
      }));

      try {
        const { seedTestUser } = await import('../e2e/src/support/seedTestUser');
        await seedTestUser();

        // Verify at least one query was executed
        expect(queryCalls.length).toBeGreaterThan(0);

        // Security assertion: no user input appears directly in the SQL string
        queryCalls.forEach(({ sql, params }) => {
          // Every DML query must use numbered placeholders
          expect(sql).toMatch(/\$\d+/);

          // User-supplied values must NOT be interpolated into SQL
          expect(sql).not.toContain(email);
          expect(sql).not.toContain(password);

          // The email must be present in the parameters array (not the SQL string)
          if (params) {
            const containsEmail = params.some(
              (p) => typeof p === 'string' && (p === email || p === email.toLowerCase()),
            );
            expect(containsEmail).toBe(true);
          }
        });
      } finally {
        // Restore env vars regardless of test outcome
        if (savedEmail === undefined) delete process.env.E2E_TEST_USER_EMAIL;
        else process.env.E2E_TEST_USER_EMAIL = savedEmail;

        if (savedPassword === undefined) delete process.env.E2E_TEST_USER_PASSWORD;
        else process.env.E2E_TEST_USER_PASSWORD = savedPassword;

        if (savedDbUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = savedDbUrl;
      }
    },
  );
});
