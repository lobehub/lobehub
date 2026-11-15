// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-hetero-env-test-user';
const agentModel = new AgentModel(serverDB, userId);

const provider = (env: Record<string, string | null>) => ({
  args: [],
  command: 'claude',
  env,
  type: 'claude-code' as const,
});

const readEnv = async (agentId: string) => {
  const row = await serverDB.query.agents.findFirst({ where: eq(agents.id, agentId) });
  return row?.agencyConfig?.heterogeneousProvider?.env;
};

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

/**
 * Agent config patches are deep-merged, and a merge stores a `null` patch value
 * as `null`. In `heterogeneousProvider.env` that left `CLAUDE_CONFIG_DIR: null`
 * behind, which the device quota RPC rejected outright; a `null` env value
 * must delete the key instead.
 */
describe('AgentModel heterogeneousProvider.env null values', () => {
  it('updateConfig deletes an env key patched to null and keeps the rest', async () => {
    await serverDB.insert(agents).values({
      agencyConfig: {
        heterogeneousProvider: provider({
          CLAUDE_CODE_ENTRYPOINT: 'lobehub',
          CLAUDE_CONFIG_DIR: '/profiles/work',
          GITHUB_CRED_KEY: '',
        }) as any,
      },
      id: 'hetero-env-update-config',
      userId,
    });

    await agentModel.updateConfig('hetero-env-update-config', {
      agencyConfig: { heterogeneousProvider: { env: { CLAUDE_CONFIG_DIR: null } } } as any,
    });

    expect(await readEnv('hetero-env-update-config')).toEqual({
      CLAUDE_CODE_ENTRYPOINT: 'lobehub',
      GITHUB_CRED_KEY: '',
    });
  });

  it('updateConfig clears a null env value left by an earlier write', async () => {
    await serverDB.insert(agents).values({
      agencyConfig: {
        heterogeneousProvider: provider({
          CLAUDE_CODE_ENTRYPOINT: 'lobehub',
          CLAUDE_CONFIG_DIR: null,
        }) as any,
      },
      id: 'hetero-env-stale-null',
      userId,
    });

    await agentModel.updateConfig('hetero-env-stale-null', {
      agencyConfig: { heterogeneousProvider: { env: { GITHUB_CRED_KEY: '' } } } as any,
    });

    expect(await readEnv('hetero-env-stale-null')).toEqual({
      CLAUDE_CODE_ENTRYPOINT: 'lobehub',
      GITHUB_CRED_KEY: '',
    });
  });

  it('update drops only null env values from a replaced agencyConfig', async () => {
    await serverDB.insert(agents).values({ id: 'hetero-env-update', userId });

    await agentModel.update('hetero-env-update', {
      agencyConfig: {
        heterogeneousProvider: provider({
          CLAUDE_CONFIG_DIR: null,
          KEEP: 'yes',
          // The spawn stringifies it, so a hand-written number keeps working.
          MAX_THINKING_TOKENS: 8000 as unknown as string,
        }) as any,
      },
    });

    expect(await readEnv('hetero-env-update')).toEqual({ KEEP: 'yes', MAX_THINKING_TOKENS: 8000 });
  });

  it('create drops null env values', async () => {
    const created = await agentModel.create({
      agencyConfig: {
        heterogeneousProvider: provider({ CLAUDE_CONFIG_DIR: null, KEEP: 'yes' }) as any,
      },
    });

    expect(await readEnv(created.id)).toEqual({ KEEP: 'yes' });
  });

  it('leaves a null outside env stored as null', async () => {
    await serverDB.insert(agents).values({
      agencyConfig: { heterogeneousProvider: provider({ KEEP: 'yes' }) as any },
      id: 'hetero-env-other-null',
      userId,
    });

    await agentModel.updateConfig('hetero-env-other-null', {
      agencyConfig: { subagent: { model: null } } as any,
    });

    const row = await serverDB.query.agents.findFirst({
      where: eq(agents.id, 'hetero-env-other-null'),
    });
    expect((row?.agencyConfig as any)?.subagent).toEqual({ model: null });
  });
});
