import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

import bcrypt from 'bcryptjs';
import { describe, expect, it, vi } from 'vitest';

async function captureSeedQueries() {
  const script = await readFile(
    new URL('../../../.agents/acceptance/scripts/init-dev-env.sh', import.meta.url),
    'utf8',
  );
  const source = script.match(/seed_user\(\) \{[\s\S]*?node <<'NODE'\n([\s\S]*?)\nNODE/);
  expect(
    source,
    'the acceptance bootstrap must contain its seed-user implementation',
  ).not.toBeNull();

  const query = vi.fn(async () => ({ rowCount: 0 }));
  const require = createRequire(import.meta.url);
  await runInNewContext(source![1], {
    Buffer,
    console: { error: vi.fn(), log: vi.fn() },
    process: {
      env: {
        DATABASE_URL: 'postgresql://localhost/acceptance-fixture',
        KEY_VAULTS_SECRET: Buffer.alloc(32).toString('base64'),
      },
      exit: (code: number) => {
        throw new Error(`seed-user exited with ${code}`);
      },
    },
    require: (name: string) => {
      if (name === 'pg') {
        return {
          Client: class {
            connect = vi.fn();
            end = vi.fn();
            query = query;
          },
        };
      }
      if (name === 'node:fs') return { mkdirSync: vi.fn(), writeFileSync: vi.fn() };
      return require(name);
    },
  });

  return query.mock.calls as unknown as [string, unknown[]][];
}

describe('acceptance bootstrap credentials', () => {
  it('seeds a password account owned by the local user ID', async () => {
    const queries = await captureSeedQueries();
    const user = queries.find(([sql]) => sql.includes('INSERT INTO users'))![1];
    const account = queries.find(([sql]) => sql.includes('INSERT INTO accounts'))![1];

    expect(account[1]).toBe(user[0]);
    expect(account[2]).toBe(user[0]);
    expect(account[3]).toBe('credential');
    expect(await bcrypt.compare('TestPassword123!', account[4] as string)).toBe(true);
  });

  it('repairs existing fixture credentials when the seed is rerun', async () => {
    const queries = await captureSeedQueries();
    const [sql] = queries.find(([statement]) => statement.includes('INSERT INTO accounts'))!;

    expect(sql).toContain('ON CONFLICT (id) DO UPDATE');
    expect(sql).toContain('account_id = EXCLUDED.account_id');
    expect(sql).toContain('password = EXCLUDED.password');
  });
});
