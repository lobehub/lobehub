import { describe, expect, it, vi } from 'vitest';

import { resolveClaudeAccountSpawnEnv } from '../claudeCodeAccountRouting';

const login = (externalAccountId: string, configDir: string | null = null) => ({
  configDir,
  identity: { externalAccountId },
});
const pinned = {
  candidates: [{ externalAccountId: 'acc-a', name: 'a@example.com' }],
  mode: 'pinned' as const,
};
const balanced = {
  candidates: [{ externalAccountId: 'acc-a' }, { externalAccountId: 'acc-b' }],
  mode: 'balanced' as const,
};

describe('resolveClaudeAccountSpawnEnv', () => {
  it('leaves an unrouted run on the default login without reading logins', async () => {
    const listLogins = vi.fn();

    expect(await resolveClaudeAccountSpawnEnv(undefined, { inheritedEnv: {}, listLogins })).toEqual(
      { env: {}, kind: 'spawn' },
    );
    expect(listLogins).not.toHaveBeenCalled();
  });

  it('spawns a pinned profile login with its CLAUDE_CONFIG_DIR', async () => {
    const prepareLogin = vi.fn(async () => ({
      configDir: '/profiles/a',
      kind: 'profile' as const,
    }));

    const result = await resolveClaudeAccountSpawnEnv(pinned, {
      inheritedEnv: {},
      listLogins: async () => [login('acc-b'), login('acc-a', '/profiles/a')],
      prepareLogin,
    });

    expect(result).toEqual({ env: { CLAUDE_CONFIG_DIR: '/profiles/a' }, kind: 'spawn' });
    expect(prepareLogin).toHaveBeenCalledWith('acc-a');
  });

  it('keeps the default login when that is the pinned account', async () => {
    expect(
      await resolveClaudeAccountSpawnEnv(pinned, {
        inheritedEnv: {},
        listLogins: async () => [login('acc-a')],
      }),
    ).toEqual({ env: {}, kind: 'spawn' });
  });

  it('rejects a pin this device holds no login for, naming the account', async () => {
    const result = await resolveClaudeAccountSpawnEnv(pinned, {
      inheritedEnv: {},
      listLogins: async () => [login('acc-b')],
    });

    expect(result).toEqual({ kind: 'reject', reason: expect.stringContaining('a@example.com') });
  });

  it('rejects a pin when the logins cannot be read, but lets auto mode run', async () => {
    const listLogins = async () => {
      throw new Error('keychain locked');
    };

    expect(
      await resolveClaudeAccountSpawnEnv(pinned, { inheritedEnv: {}, listLogins }),
    ).toMatchObject({ kind: 'reject' });
    expect(await resolveClaudeAccountSpawnEnv(balanced, { inheritedEnv: {}, listLogins })).toEqual({
      env: {},
      kind: 'spawn',
    });
  });

  it('balances onto a candidate this device holds', async () => {
    expect(
      await resolveClaudeAccountSpawnEnv(balanced, {
        inheritedEnv: {},
        listLogins: async () => [login('acc-c'), login('acc-b', '/profiles/b')],
      }),
    ).toEqual({ env: { CLAUDE_CONFIG_DIR: '/profiles/b' }, kind: 'spawn' });
  });

  it('stays out of a run the device routes to an external provider', async () => {
    const listLogins = vi.fn();

    expect(
      await resolveClaudeAccountSpawnEnv(pinned, {
        inheritedEnv: { CLAUDE_CODE_USE_BEDROCK: '1' },
        listLogins,
      }),
    ).toEqual({ env: {}, kind: 'spawn' });
    expect(listLogins).not.toHaveBeenCalled();
  });
});
