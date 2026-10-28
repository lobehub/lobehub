// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentBotProviders, agents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentBotProviderModel } from '../agentBotProvider';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'bot-provider-cov-user';
const agentId = 'bot-provider-cov-agent';
const platform = 'bot-provider-cov-platform';

/** A gateKeeper whose ciphertext is just the plaintext, so stored rows stay readable. */
const passthroughGateKeeper = {
  decrypt: async (ciphertext: string) => ({ plaintext: ciphertext }),
  encrypt: async (plaintext: string) => plaintext,
};

/** Seed a provider row with raw credentials, bypassing the model's encryption. */
const seed = async (applicationId: string, credentials: string | null, enabled = true) => {
  const [row] = await serverDB
    .insert(agentBotProviders)
    .values({ agentId, applicationId, credentials, enabled, platform, userId })
    .returning();
  return row;
};

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(agents).values({ id: agentId, userId });
});

afterEach(async () => {
  // Providers cascade with their agent and owner.
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

describe('AgentBotProviderModel coverage', () => {
  describe('findByIds', () => {
    it('skips the query when no id is UUID-shaped', async () => {
      expect(await AgentBotProviderModel.findByIds(serverDB, [])).toEqual([]);
      expect(await AgentBotProviderModel.findByIds(serverDB, ['system-bot:discord'])).toEqual([]);
    });

    it('returns the rows matching the UUID-shaped ids and ignores the rest', async () => {
      const row = await seed('cov-by-ids', '{}', false);

      const found = await AgentBotProviderModel.findByIds(serverDB, [
        row.id,
        'system-bot:discord',
        '00000000-0000-4000-8000-000000000000',
      ]);

      expect(found).toEqual([
        {
          applicationId: 'cov-by-ids',
          enabled: false,
          id: row.id,
          platform,
          settings: row.settings,
        },
      ]);
    });
  });

  describe('findEnabledByPlatformAndAppId', () => {
    it('returns empty credentials for a row without any', async () => {
      await seed('cov-no-creds', null);

      const found = await AgentBotProviderModel.findEnabledByPlatformAndAppId(
        serverDB,
        platform,
        'cov-no-creds',
      );

      expect(found).toMatchObject({ applicationId: 'cov-no-creds', credentials: {} });
    });

    it('returns empty credentials when they fail to parse', async () => {
      await seed('cov-bad-creds', 'not-json');

      const found = await AgentBotProviderModel.findEnabledByPlatformAndAppId(
        serverDB,
        platform,
        'cov-bad-creds',
        passthroughGateKeeper,
      );

      expect(found).toMatchObject({ applicationId: 'cov-bad-creds', credentials: {} });
    });
  });

  describe('static findByAgentId', () => {
    it('decodes plain JSON, and falls back to empty credentials for missing or broken ones', async () => {
      await seed('cov-agent-plain', JSON.stringify({ botToken: 'plain' }));
      await seed('cov-agent-none', null);
      await seed('cov-agent-broken', '{broken');

      const rows = await AgentBotProviderModel.findByAgentId(serverDB, agentId);

      const byApp = Object.fromEntries(rows.map((r) => [r.applicationId, r.credentials]));
      expect(byApp).toEqual({
        'cov-agent-broken': {},
        'cov-agent-none': {},
        'cov-agent-plain': { botToken: 'plain' },
      });
    });
  });

  describe('findEnabledByPlatform', () => {
    it('keeps missing and undecryptable rows only when asked to', async () => {
      await seed('cov-platform-ok', JSON.stringify({ botToken: 'ok' }));
      await seed('cov-platform-none', null);
      await seed('cov-platform-broken', '{broken');

      const strict = await AgentBotProviderModel.findEnabledByPlatform(
        serverDB,
        platform,
        passthroughGateKeeper,
      );
      expect(strict.map((r) => r.applicationId)).toEqual(['cov-platform-ok']);

      const lenient = await AgentBotProviderModel.findEnabledByPlatform(
        serverDB,
        platform,
        passthroughGateKeeper,
        { includeUndecryptable: true },
      );
      expect(Object.fromEntries(lenient.map((r) => [r.applicationId, r.credentials]))).toEqual({
        'cov-platform-broken': {},
        'cov-platform-none': {},
        'cov-platform-ok': { botToken: 'ok' },
      });
    });
  });
});
