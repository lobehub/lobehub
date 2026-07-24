// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentProviderAccounts, agents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  AgentAccountBindingModel,
  AgentProviderAccountModel,
  AgentQuotaCalibrationModel,
  AgentQuotaSnapshotModel,
  AgentQuotaUsageLedgerModel,
  AgentQuotaWindowModel,
} from '../agentQuota';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-quota-test-user';
const agentId = 'agent-quota-test-agent';
const validKeyVaultsSecret = 'ofQiJCXLF8mYemwfMWLOHoHimlPu91YmLfU7YZ4lreQ=';

let accounts: AgentProviderAccountModel;
let bindings: AgentAccountBindingModel;
let snapshots: AgentQuotaSnapshotModel;
let ledger: AgentQuotaUsageLedgerModel;
let windows: AgentQuotaWindowModel;
let calibrations: AgentQuotaCalibrationModel;
let originalSecret: string | undefined;

beforeEach(async () => {
  originalSecret = process.env.KEY_VAULTS_SECRET;
  process.env.KEY_VAULTS_SECRET = validKeyVaultsSecret;

  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(agents).values({ id: agentId, userId });

  accounts = new AgentProviderAccountModel(serverDB, userId);
  bindings = new AgentAccountBindingModel(serverDB, userId);
  snapshots = new AgentQuotaSnapshotModel(serverDB, userId);
  ledger = new AgentQuotaUsageLedgerModel(serverDB, userId);
  windows = new AgentQuotaWindowModel(serverDB, userId);
  calibrations = new AgentQuotaCalibrationModel(serverDB, userId);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  process.env.KEY_VAULTS_SECRET = originalSecret;
});

describe('AgentProviderAccountModel', () => {
  it('creates a referenced account and never leaks credentials in listings', async () => {
    const created = await accounts.create({
      credentialMode: 'referenced',
      credentialRef: { origin: 'keychain' },
      label: 'Main 20x',
      provider: 'claude-code',
    });
    expect(created).not.toHaveProperty('credentials');
    const list = await accounts.list();
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty('credentials');
    expect(list[0].label).toBe('Main 20x');
  });

  it('encrypts managed credentials at rest and round-trips them', async () => {
    const created = await accounts.create({
      credentialMode: 'managed',
      credentials: {
        accessToken: 'secret-token-abc',
        expiresAt: 1_800_000_000_000,
        refreshToken: 'r1',
      },
      provider: 'claude-code',
    });

    // stored ciphertext must not contain the plaintext token
    const raw = await serverDB.query.agentProviderAccounts.findFirst({
      where: eq(agentProviderAccounts.id, created.id),
    });
    expect(raw?.credentials).toBeTruthy();
    expect(raw?.credentials).not.toContain('secret-token-abc');
    // tokenExpiresAt promoted out of the blob for the refresh worker
    expect(raw?.tokenExpiresAt?.getTime()).toBe(1_800_000_000_000);

    const decrypted = await accounts.getCredentials(created.id);
    expect(decrypted?.accessToken).toBe('secret-token-abc');
    expect(decrypted?.refreshToken).toBe('r1');
  });

  it('dedupes by external account id (multi-device merge)', async () => {
    const first = await accounts.upsertByIdentity('claude-code', {
      email: 'a@example.com',
      externalAccountId: 'uuid-1',
      planTier: 'max',
    });
    const second = await accounts.upsertByIdentity('claude-code', {
      displayName: 'Arvin',
      email: 'a@example.com',
      externalAccountId: 'uuid-1',
      rateLimitTier: 'default_claude_max_20x',
    });
    expect(second.id).toBe(first.id);
    const list = await accounts.list();
    expect(list).toHaveLength(1);
    expect(list[0].displayName).toBe('Arvin');
    expect(list[0].rateLimitTier).toBe('default_claude_max_20x');
  });
});

describe('AgentAccountBindingModel', () => {
  it('pins one account and demotes the previously pinned sibling', async () => {
    const a1 = await accounts.create({ provider: 'claude-code' });
    const a2 = await accounts.create({ provider: 'claude-code' });
    await bindings.upsert({ accountId: a1.id, agentId, role: 'pinned' });
    await bindings.upsert({ accountId: a2.id, agentId, role: 'pool' });

    // switch: pin a2
    await bindings.pin(agentId, a2.id);
    const rows = await bindings.listByAgent(agentId);
    const pinned = rows.filter((r) => r.role === 'pinned');
    expect(pinned).toHaveLength(1);
    expect(pinned[0].accountId).toBe(a2.id);
  });

  it('upsert is idempotent on (agent, account)', async () => {
    const a1 = await accounts.create({ provider: 'claude-code' });
    await bindings.upsert({ accountId: a1.id, agentId, priority: 1 });
    await bindings.upsert({ accountId: a1.id, agentId, priority: 5 });
    const rows = await bindings.listByAgent(agentId);
    expect(rows).toHaveLength(1);
    expect(rows[0].priority).toBe(5);
  });
});

describe('quota data tables', () => {
  const reset = new Date('2026-07-12T20:50:00Z');

  it('appends snapshots and reads the latest per bucket', async () => {
    const a1 = await accounts.create({ provider: 'claude-code' });
    await snapshots.append([
      {
        accountId: a1.id,
        capturedAt: new Date('2026-07-12T18:00:00Z'),
        limitType: 'session',
        resetsAt: reset,
        scopeKey: '',
        utilization: 20,
      },
      {
        accountId: a1.id,
        capturedAt: new Date('2026-07-12T19:00:00Z'),
        limitType: 'session',
        resetsAt: reset,
        scopeKey: '',
        utilization: 26,
      },
      {
        accountId: a1.id,
        capturedAt: new Date('2026-07-12T19:00:00Z'),
        limitType: 'weekly_scoped',
        resetsAt: reset,
        scopeKey: 'Fable',
        utilization: 38,
      },
    ]);
    const latest = await snapshots.latestPerBucket(a1.id);
    const session = latest.find((r) => r.limitType === 'session');
    expect(session?.utilization).toBe(26);
    const fable = latest.find((r) => r.scopeKey === 'Fable');
    expect(fable?.utilization).toBe(38);
  });

  it('window upsert merges peak via GREATEST and keeps earliest 429', async () => {
    const a1 = await accounts.create({ provider: 'claude-code' });
    const base = {
      accountId: a1.id,
      limitType: 'session',
      resetsAt: reset,
      scopeKey: '',
      windowSeconds: 18_000,
      windowStartAt: new Date('2026-07-12T15:50:00Z'),
    };
    await windows.upsert({
      ...base,
      lastUtilization: 80,
      peakUtilization: 80,
      rateLimitedAt: new Date('2026-07-12T19:30:00Z'),
    });
    // a later, out-of-order lower sample must NOT lower the peak, and must not overwrite the 429
    await windows.upsert({
      ...base,
      lastUtilization: 40,
      peakUtilization: 40,
      rateLimitedAt: null,
    });
    const list = await windows.listByAccount(a1.id);
    expect(list).toHaveLength(1);
    expect(list[0].peakUtilization).toBe(80);
    expect(list[0].lastUtilization).toBe(40);
    expect(list[0].rateLimitedAt?.toISOString()).toBe('2026-07-12T19:30:00.000Z');
  });

  it('ledger is idempotent by externalEventId and sums cost in a window', async () => {
    const a1 = await accounts.create({ provider: 'claude-code' });
    const row = {
      accountId: a1.id,
      costUsd: 12.5,
      externalEventId: 'msg-1:0',
      model: 'claude-opus-4-8',
      occurredAt: new Date('2026-07-12T18:30:00Z'),
      provider: 'claude-code',
    };
    await ledger.append(row);
    await ledger.append(row); // duplicate — ignored
    await ledger.append({
      ...row,
      costUsd: 7.5,
      externalEventId: 'msg-2:0',
      occurredAt: new Date('2026-07-12T19:00:00Z'),
    });

    const total = await ledger.sumCostUsd(a1.id, new Date('2026-07-12T15:50:00Z'), reset);
    expect(total).toBeCloseTo(20, 6);
  });

  it('stores and reads back the latest calibration', async () => {
    const a1 = await accounts.create({ provider: 'claude-code' });
    await calibrations.insert({
      accountId: a1.id,
      capacityUsd: 500,
      confidence: 0.4,
      limitType: 'session',
      method: 'ratio-median',
      sampleCount: 8,
      scopeKey: '',
    });
    await calibrations.insert({
      accountId: a1.id,
      calibratedAt: new Date(Date.now() + 1000),
      capacityUsd: 548,
      confidence: 0.6,
      limitType: 'session',
      method: 'ratio-median',
      sampleCount: 12,
      scopeKey: '',
    });
    const latest = await calibrations.latest(a1.id, 'session', '');
    expect(Number(latest?.capacityUsd)).toBe(548);
    expect(latest?.sampleCount).toBe(12);
  });
});
