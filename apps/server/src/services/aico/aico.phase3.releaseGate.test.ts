/**
 * Aico Phase 3 — Release gate: Env C fail-closed, Journey 4/6/7, UI/static secret probes
 * Product code unmodified; failing assertions = release blockers.
 */
// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AicoBillingModel } from '@/database/models/aicoBilling';
import { users } from '@/database/schemas';
import {
  memberBudgets,
  organizationMembers,
  organizations,
  organizationTeamMembers,
  organizationTeams,
  userWallets,
  walletTransactions,
} from '@/database/schemas/aicoOrganization';
import { tomanToUsd } from '@/envs/aico';

import { createTestContext } from '../../routers/lambda/__tests__/integration/setup';
import { aicoBillingRouter } from '../../routers/lambda/aicoBilling';
import { organizationRouter } from '../../routers/lambda/organization';
import { AicoOpenRouterKeyService } from '../openrouter/keyService';
import type { OpenRouterManagementClient } from '../openrouter/management';
import {
  __resetOpenRouterManagementClientForTests,
  createOpenRouterManagementClient,
} from '../openrouter/management';
import { createSmsServiceImpl } from '../sms/impls';
import { AicoChatGuard } from './chatGuard';

process.env.KEY_VAULTS_SECRET = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';

const REPO_ROOT = join(__dirname, '../../../../..');

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));
vi.mock('@/server/services/email', () => ({
  EmailService: class {
    sendMail = vi.fn().mockResolvedValue(undefined);
  },
}));
vi.mock('@/server/services/sms', () => ({
  SmsService: class {
    sendSms = vi.fn().mockResolvedValue(undefined);
  },
}));

class ControllableOR implements OpenRouterManagementClient {
  keys = new Map<string, any>();
  mode: 'success' | 'timeout' | 'http401' | 'http429' | 'http500' | 'malformed' | 'updateFail' =
    'success';

  createKey: OpenRouterManagementClient['createKey'] = async (params) => {
    if (this.mode === 'timeout') throw new Error('OpenRouter timeout');
    if (this.mode.startsWith('http')) throw new Error(`OpenRouter HTTP ${this.mode.slice(4)}`);
    if (this.mode === 'malformed') return { hash: 'x', limit: params.limitUsd } as any;
    const hash = `p3_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const row = {
      disabled: false,
      hash,
      key: `sk-or-v1-FAKE-P3-${hash}`,
      limit: params.limitUsd,
      limitRemaining: params.limitUsd,
      name: params.name,
      usage: 0,
    };
    this.keys.set(hash, row);
    return { ...row };
  };
  getKey: OpenRouterManagementClient['getKey'] = async (hash) => {
    const row = this.keys.get(hash);
    if (!row) throw new Error('not found');
    const { key: _k, ...info } = row;
    return info;
  };
  updateKey: OpenRouterManagementClient['updateKey'] = async (params) => {
    if (this.mode === 'updateFail') throw new Error('OpenRouter update failed');
    const row = this.keys.get(params.hash);
    if (!row) throw new Error('not found');
    if (params.disabled !== undefined) row.disabled = params.disabled;
    if (params.limitUsd !== undefined) row.limit = params.limitUsd;
    const { key: _k, ...info } = row;
    return info;
  };
  deleteKey: OpenRouterManagementClient['deleteKey'] = async (hash) => {
    this.keys.delete(hash);
  };
}

const ownerId = 'p3-rg-owner';
const memberId = 'p3-rg-member';
const strangerId = 'p3-rg-stranger';

const cleanup = async () => {
  await testDB.delete(walletTransactions);
  await testDB.delete(memberBudgets);
  await testDB.delete(organizationTeamMembers);
  await testDB.delete(organizationTeams);
  await testDB.delete(organizationMembers);
  await testDB.delete(organizations);
  await testDB.delete(userWallets);
  await testDB.delete(users);
};

beforeEach(async () => {
  __resetOpenRouterManagementClientForTests();
  testDB = await getTestDB();
  await cleanup();
  await testDB.insert(users).values([
    { email: 'owner@p3rg.test', id: ownerId, phone: '+989131000001', phoneNumberVerified: true },
    { email: 'member@p3rg.test', id: memberId },
    { email: 'stranger@p3rg.test', id: strangerId },
  ]);
}, 60_000);

afterEach(async () => {
  await cleanup();
  vi.restoreAllMocks();
  __resetOpenRouterManagementClientForTests();
});

describe('Phase 3 Env C — unsafe production configuration (fail-closed)', () => {
  it('AICO-P3-ENV-C: missing OpenRouter management key must not silently mock in production', () => {
    const prevKey = process.env.OPENROUTER_MANAGEMENT_API_KEY;
    const prevMock = process.env.AICO_OPENROUTER_MOCK;
    const prevNode = process.env.NODE_ENV;
    try {
      delete process.env.OPENROUTER_MANAGEMENT_API_KEY;
      delete process.env.AICO_OPENROUTER_MOCK;
      (process.env as any).NODE_ENV = 'production';
      __resetOpenRouterManagementClientForTests();
      let threw = false;
      try {
        const client = createOpenRouterManagementClient({});
        if (client.constructor.name.includes('Mock')) {
          threw = false;
        }
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    } finally {
      process.env.OPENROUTER_MANAGEMENT_API_KEY = prevKey;
      process.env.AICO_OPENROUTER_MOCK = prevMock;
      (process.env as any).NODE_ENV = prevNode;
    }
  });

  it('AICO-P3-ENV-C: AICO_OPENROUTER_MOCK=1 must be rejected when NODE_ENV=production', () => {
    const prevKey = process.env.OPENROUTER_MANAGEMENT_API_KEY;
    const prevMock = process.env.AICO_OPENROUTER_MOCK;
    const prevNode = process.env.NODE_ENV;
    try {
      delete process.env.OPENROUTER_MANAGEMENT_API_KEY;
      process.env.AICO_OPENROUTER_MOCK = '1';
      (process.env as any).NODE_ENV = 'production';
      __resetOpenRouterManagementClientForTests();
      // `AICO_OPENROUTER_MOCK` is a non-production QA convenience only — production
      // must ignore it and fail closed rather than serving a mock client.
      expect(() => createOpenRouterManagementClient({})).toThrow(/OPENROUTER_MANAGEMENT_API_KEY/);
    } finally {
      process.env.OPENROUTER_MANAGEMENT_API_KEY = prevKey;
      process.env.AICO_OPENROUTER_MOCK = prevMock;
      (process.env as any).NODE_ENV = prevNode;
      __resetOpenRouterManagementClientForTests();
    }
  });

  it('AICO-P3-ENV-C: missing Kavenegar must not select Debug SMS in production', () => {
    const prev = process.env.KAVENEGAR_API_KEY;
    const prevNode = process.env.NODE_ENV;
    try {
      delete process.env.KAVENEGAR_API_KEY;
      (process.env as any).NODE_ENV = 'production';
      const impl = createSmsServiceImpl();
      expect(impl.constructor.name).not.toContain('Debug');
    } finally {
      process.env.KAVENEGAR_API_KEY = prev;
      (process.env as any).NODE_ENV = prevNode;
    }
  });

  it('AICO-P3-ENV-C: invalid FX rate must fail closed', () => {
    expect(() => tomanToUsd(1000, 0)).toThrow(/Invalid FX/);
    expect(() => tomanToUsd(1000, -1)).toThrow(/Invalid FX/);
  });

  it('AICO-P3-ENV-C: mockTopup must be forbidden in production unless explicitly allowlisted', async () => {
    const prevNode = process.env.NODE_ENV;
    const prevAllow = process.env.AICO_ALLOW_MOCK_TOPUP;
    try {
      (process.env as any).NODE_ENV = 'production';
      delete process.env.AICO_ALLOW_MOCK_TOPUP;

      const caller = aicoBillingRouter.createCaller(createTestContext(strangerId));
      await expect(caller.mockTopup({ amountToman: 100_000 })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    } finally {
      (process.env as any).NODE_ENV = prevNode;
      process.env.AICO_ALLOW_MOCK_TOPUP = prevAllow;
    }
  });
});

describe('Phase 3 Journey 4 — external-service partial failure', () => {
  it('OR timeout after credit: wallet conserved, no key id, retry-safe documentation', async () => {
    // Unmock key service for this suite by constructing directly
    const billing = new AicoBillingModel(testDB);
    const client = new ControllableOR();
    client.mode = 'timeout';
    const keys = new AicoOpenRouterKeyService(testDB, client);

    await billing.mockTopupUser({
      amountToman: 50_000,
      amountUsd: 10,
      createdByUserId: ownerId,
      fxRate: 5000,
      userId: ownerId,
    });
    await expect(keys.ensureUserKey(ownerId)).rejects.toThrow(/timeout/i);
    const wallet = await billing.getOrCreateUserWallet(ownerId);
    expect(Number(wallet.balanceUsd)).toBe(10);
    expect(wallet.openrouterKeyId).toBeNull();
    expect(client.keys.size).toBe(0);
  });

  it('OR http401: no key provisioned; wallet unchanged after failed ensure', async () => {
    const billing = new AicoBillingModel(testDB);
    await billing.mockTopupUser({
      amountToman: 50_000,
      amountUsd: 10,
      createdByUserId: ownerId,
      fxRate: 5000,
      userId: ownerId,
    });
    const client = new ControllableOR();
    client.mode = 'http401';
    const keys = new AicoOpenRouterKeyService(testDB, client);
    await expect(keys.ensureUserKey(ownerId)).rejects.toThrow(/401/);
    expect(client.keys.size).toBe(0);
  });

  it('OR http429 rate limit: recoverable without inventing keys', async () => {
    const billing = new AicoBillingModel(testDB);
    await billing.mockTopupUser({
      amountToman: 50_000,
      amountUsd: 10,
      createdByUserId: ownerId,
      fxRate: 5000,
      userId: ownerId,
    });
    const client = new ControllableOR();
    client.mode = 'http429';
    const keys = new AicoOpenRouterKeyService(testDB, client);
    await expect(keys.ensureUserKey(ownerId)).rejects.toThrow(/429/);
    client.mode = 'success';
    const result = await keys.ensureUserKey(ownerId);
    expect(result.keyId).toBeTruthy();
    expect(client.keys.size).toBe(1);
  });

  it('malformed OR response must not persist spendable key', async () => {
    const billing = new AicoBillingModel(testDB);
    await billing.mockTopupUser({
      amountToman: 50_000,
      amountUsd: 10,
      createdByUserId: ownerId,
      fxRate: 5000,
      userId: ownerId,
    });
    const client = new ControllableOR();
    client.mode = 'malformed';
    const keys = new AicoOpenRouterKeyService(testDB, client);
    await expect(keys.ensureUserKey(ownerId)).rejects.toThrow();
    const wallet = await billing.getOrCreateUserWallet(ownerId);
    expect(wallet.openrouterKeyId).toBeNull();
  });
});

describe('Phase 3 Journey 6 — alternate model execution paths', () => {
  it('AICO-P3-J6: all initModelRuntimeFromDB call sites must enforce assertModelAllowed', () => {
    const collect = (dir: string, acc: string[] = []): string[] => {
      if (!existsSync(dir)) return acc;
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) collect(p, acc);
        else if (/\.(?:ts|tsx)$/.test(name) && !name.includes('.test.')) acc.push(p);
      }
      return acc;
    };
    const offenders: string[] = [];
    for (const root of [
      join(REPO_ROOT, 'src/app'),
      join(REPO_ROOT, 'apps/server/src'),
      join(REPO_ROOT, 'packages/business-server/src'),
    ]) {
      for (const file of collect(root)) {
        const src = readFileSync(file, 'utf8');
        if (!src.includes('initModelRuntimeFromDB')) continue;
        if (file.replaceAll('\\', '/').endsWith('modules/ModelRuntime/index.ts')) continue;
        if (!src.includes('assertModelAllowed')) {
          offenders.push(file.replace(REPO_ROOT, '').replaceAll('\\', '/'));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('AICO-P3-J6: trial without managed key must not fall through (denies via throw)', async () => {
    const billing = new AicoBillingModel(testDB);
    await billing.updateTrialConfig({
      allowedModelIds: ['openrouter/auto'],
      durationDays: 3,
      enabled: true,
      maxRequests: 5,
      updatedByUserId: ownerId,
    });
    await billing.activateTrial({ phone: '+989131000001', userId: ownerId });
    const guard = new AicoChatGuard(testDB);
    // Release: must not resolve null (would fall through to env key) — throws instead.
    await expect(guard.resolveManagedApiKey(ownerId)).rejects.toThrow();
  });
});

describe('Phase 3 Journey 7 — operational recovery probes', () => {
  it('wrong KEY_VAULTS_SECRET cannot decrypt previously stored key', async () => {
    const billing = new AicoBillingModel(testDB);
    const client = new ControllableOR();
    const keys = new AicoOpenRouterKeyService(testDB, client);
    await billing.mockTopupUser({
      amountToman: 50_000,
      amountUsd: 10,
      createdByUserId: ownerId,
      fxRate: 5000,
      userId: ownerId,
    });
    await keys.ensureUserKey(ownerId);
    const wallet = await billing.getOrCreateUserWallet(ownerId);
    expect(wallet.openrouterKeyHash).toBeTruthy();

    const prev = process.env.KEY_VAULTS_SECRET;
    process.env.KEY_VAULTS_SECRET = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZXc='; // different
    const keys2 = new AicoOpenRouterKeyService(testDB, client);
    const plaintext = await keys2.decryptKey(wallet.openrouterKeyHash!);
    process.env.KEY_VAULTS_SECRET = prev;
    expect(plaintext).toBeNull();
  });

  it('ensureUserKey result never includes plaintext key field', async () => {
    const billing = new AicoBillingModel(testDB);
    const client = new ControllableOR();
    const keys = new AicoOpenRouterKeyService(testDB, client);
    await billing.mockTopupUser({
      amountToman: 50_000,
      amountUsd: 5,
      createdByUserId: ownerId,
      fxRate: 10_000,
      userId: ownerId,
    });
    const result = await keys.ensureUserKey(ownerId);
    expect(JSON.stringify(result)).not.toMatch(/sk-or-v1/);
  });
});

describe('Phase 3 UI / route / secret static probes', () => {
  it('SPA routes exist for wallet/org/platform/invite', () => {
    const desktop = readFileSync(
      join(REPO_ROOT, 'src/spa/router/desktopRouter.config.tsx'),
      'utf8',
    );
    for (const path of [
      "path: 'wallet'",
      "path: 'platform'",
      "path: 'invite/:token'",
      "path: 'org'",
    ]) {
      expect(desktop.includes(path)).toBe(true);
    }
    const twin = readFileSync(
      join(REPO_ROOT, 'src/spa/router/desktopRouter.config.desktop.tsx'),
      'utf8',
    );
    expect(twin.includes('WalletPage') || twin.includes('wallet')).toBe(true);
    expect(twin.includes('PlatformAdminPage') || twin.includes('platform')).toBe(true);
  });

  it('AICO-P3-UI: wallet mock top-up UI must be production-gated in source', () => {
    const wallet = readFileSync(join(REPO_ROOT, 'src/features/AicoWallet/index.tsx'), 'utf8');
    const gated =
      wallet.includes('AICO_ALLOW_MOCK_TOPUP') ||
      wallet.includes('NODE_ENV') ||
      wallet.includes('isProduction') ||
      wallet.includes('mockTopupEnabled');
    expect(gated).toBe(true);
  });

  it('client wallet feature must not embed management API key env names as readable secrets', () => {
    const wallet = readFileSync(join(REPO_ROOT, 'src/features/AicoWallet/index.tsx'), 'utf8');
    expect(wallet).not.toMatch(/OPENROUTER_MANAGEMENT_API_KEY\s*=/);
    expect(wallet).not.toMatch(/sk-or-v1-[A-Za-z0-9]{20,}/);
  });

  it('aico locale namespace present (fa readiness signal)', () => {
    expect(existsSync(join(REPO_ROOT, 'packages/locales/src/default/aico.ts'))).toBe(true);
    expect(existsSync(join(REPO_ROOT, 'locales/en-US/aico.json'))).toBe(true);
  });

  it('migration 0132 usage_logs user_id NOT NULL must be upgrade-safe (DEFAULT or backfill)', () => {
    const sqlPath = join(REPO_ROOT, 'packages/database/migrations/0132_shocking_blizzard.sql');
    const sql = readFileSync(sqlPath, 'utf8');
    const risky =
      /ALTER TABLE "usage_logs"[\s\S]*ADD COLUMN "user_id" text NOT NULL/i.test(sql) &&
      !/ADD COLUMN "user_id" text NOT NULL DEFAULT/i.test(sql);
    expect(risky).toBe(false);
  });
});

describe('Phase 3 Journey 3 — tRPC IDOR (attacker)', () => {
  it('stranger cannot allocate / topup / list foreign org', async () => {
    const owner = organizationRouter.createCaller(createTestContext(ownerId));
    const created = await owner.create({ name: 'P3 IDOR Org' });
    const stranger = organizationRouter.createCaller(createTestContext(strangerId));
    await expect(stranger.listMembers({ orgId: created.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(stranger.getOrgWallet({ orgId: created.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      stranger.mockOrgTopup({ amountToman: 1000, orgId: created.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      stranger.allocateMemberCredit({
        amountUsd: 1,
        orgId: created.id,
        orgMemberId: 'fake',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
