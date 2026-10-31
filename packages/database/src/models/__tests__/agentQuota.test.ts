// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { getTestDB } from '../../core/getTestDB';
import { agentOperations, agentProviderAccounts, agents, topics, users } from '../../schemas';
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

describe('AgentProviderAccountModel — lookups and credential lifecycle', () => {
  it('findByExternalId resolves by provider + external id inside the owner scope', async () => {
    const created = await accounts.upsertByIdentity('claude-code', {
      email: 'b@example.com',
      externalAccountId: 'uuid-ext-1',
    });

    const found = await accounts.findByExternalId('claude-code', 'uuid-ext-1');
    expect(found?.id).toBe(created.id);
    expect(found).not.toHaveProperty('credentials');
    expect(await accounts.findByExternalId('claude-code', 'missing')).toBeNull();
    expect(await accounts.findByExternalId('codex', 'uuid-ext-1')).toBeNull();
  });

  it('upsertByIdentity inserts a new row when no external id is given', async () => {
    const first = await accounts.upsertByIdentity('claude-code', { displayName: 'A' });
    const second = await accounts.upsertByIdentity('claude-code', { displayName: 'B' });

    expect(second.id).not.toBe(first.id);
    expect(await accounts.list()).toHaveLength(2);
  });

  it('create keeps expiry null when the credentials carry none', async () => {
    const created = await accounts.create({
      credentialMode: 'managed',
      credentials: { accessToken: 'no-expiry' },
      provider: 'claude-code',
    });

    const raw = await serverDB.query.agentProviderAccounts.findFirst({
      where: eq(agentProviderAccounts.id, created.id),
    });
    expect(raw?.tokenExpiresAt).toBeNull();
  });

  it('setCredentials rotates the managed blob and promotes (or clears) expiry', async () => {
    const created = await accounts.create({
      credentialMode: 'referenced',
      provider: 'claude-code',
    });

    await accounts.setCredentials(created.id, {
      accessToken: 'rotated',
      expiresAt: 1_900_000_000_000,
      refreshToken: 'r2',
    });
    expect(await accounts.getCredentials(created.id)).toMatchObject({ accessToken: 'rotated' });

    const promoted = await serverDB.query.agentProviderAccounts.findFirst({
      where: eq(agentProviderAccounts.id, created.id),
    });
    expect(promoted?.credentialMode).toBe('managed');
    expect(promoted?.tokenExpiresAt?.getTime()).toBe(1_900_000_000_000);

    await accounts.setCredentials(created.id, { accessToken: 'no-expiry' });
    const cleared = await serverDB.query.agentProviderAccounts.findFirst({
      where: eq(agentProviderAccounts.id, created.id),
    });
    expect(cleared?.tokenExpiresAt).toBeNull();
  });

  it('update patches non-credential fields and delete removes the row', async () => {
    const created = await accounts.create({ label: 'before', provider: 'claude-code' });

    await accounts.update(created.id, { label: 'after' });
    expect((await accounts.findById(created.id))?.label).toBe('after');

    await accounts.delete(created.id);
    expect(await accounts.findById(created.id)).toBeNull();
  });

  it('getCredentials returns null for a missing row, a missing blob, a tampered blob and non-JSON plaintext', async () => {
    expect(await accounts.getCredentials('00000000-0000-0000-0000-000000000000')).toBeNull();

    // referenced mode → no stored blob at all
    const referenced = await accounts.create({ provider: 'claude-code' });
    expect(await accounts.getCredentials(referenced.id)).toBeNull();

    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();

    // flipping a ciphertext byte breaks the GCM tag → wasAuthentic = false
    const authentic = await gateKeeper.encrypt(JSON.stringify({ accessToken: 'tampered' }));
    const [iv, tag, body] = authentic.split(':');
    const tampered = `${iv}:${tag}:${body.replace(/^./, (c) => (c === '0' ? '1' : '0'))}`;
    const [tamperedRow] = await serverDB
      .insert(agentProviderAccounts)
      .values({ credentialMode: 'managed', credentials: tampered, provider: 'claude-code', userId })
      .returning();
    expect(await accounts.getCredentials(tamperedRow.id)).toBeNull();

    // authentic but not JSON
    const notJson = await gateKeeper.encrypt('definitely-not-json');
    const [badRow] = await serverDB
      .insert(agentProviderAccounts)
      .values({ credentialMode: 'managed', credentials: notJson, provider: 'claude-code', userId })
      .returning();
    expect(await accounts.getCredentials(badRow.id)).toBeNull();
  });
});

describe('AgentAccountBindingModel — remove', () => {
  it('removes a binding by id', async () => {
    const account = await accounts.create({ provider: 'claude-code' });
    const binding = await bindings.upsert({ accountId: account.id, agentId });

    await bindings.remove(binding.id);

    expect(await bindings.listByAgent(agentId)).toEqual([]);
  });
});

describe('quota data tables — range reads', () => {
  it('snapshot append short-circuits an empty batch', async () => {
    expect(await snapshots.append([])).toEqual([]);
  });

  it('listRange returns readings at or after the cutoff, oldest first', async () => {
    const account = await accounts.create({ provider: 'claude-code' });
    await snapshots.append([
      {
        accountId: account.id,
        capturedAt: new Date('2026-07-12T10:00:00Z'),
        limitType: 'session',
        scopeKey: '',
        utilization: 10,
      },
      {
        accountId: account.id,
        capturedAt: new Date('2026-07-12T18:00:00Z'),
        limitType: 'session',
        scopeKey: '',
        utilization: 20,
      },
      {
        accountId: account.id,
        capturedAt: new Date('2026-07-12T20:00:00Z'),
        limitType: 'session',
        scopeKey: '',
        utilization: 30,
      },
    ]);

    const rows = await snapshots.listRange(account.id, new Date('2026-07-12T15:00:00Z'));
    expect(rows.map((r) => r.utilization)).toEqual([20, 30]);
  });

  it('listSince returns per-turn rows at or after the cutoff, oldest first', async () => {
    const account = await accounts.create({ provider: 'claude-code' });
    await ledger.append({
      accountId: account.id,
      costUsd: 1,
      occurredAt: new Date('2026-07-12T10:00:00Z'),
      provider: 'claude-code',
    });
    await ledger.append({
      accountId: account.id,
      costUsd: 2,
      occurredAt: new Date('2026-07-12T19:00:00Z'),
      provider: 'claude-code',
    });

    const rows = await ledger.listSince(account.id, new Date('2026-07-12T15:00:00Z'));
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].costUsd)).toBe(2);
  });

  it('listActiveRuns lists in-flight runs that billed the account, once each, newest first', async () => {
    const account = await accounts.create({ provider: 'claude-code' });
    const other = await accounts.create({ provider: 'claude-code' });
    await serverDB.update(agents).set({ title: 'Builder' }).where(eq(agents.id, agentId));
    await serverDB.insert(topics).values({ id: 'quota-topic', title: 'Fix login', userId });
    await serverDB.insert(agentOperations).values([
      { agentId, id: 'op-running', status: 'running', topicId: 'quota-topic', userId },
      { agentId, id: 'op-waiting', status: 'waiting_for_human', userId },
      { agentId, id: 'op-done', status: 'done', userId },
      { agentId, id: 'op-old', status: 'running', userId },
      { agentId, id: 'op-other', status: 'running', userId },
    ]);
    const turn = (operationId: string, at: string, accountId = account.id) =>
      ledger.append({
        accountId,
        occurredAt: new Date(at),
        operationId,
        provider: 'claude-code',
      });
    await turn('op-running', '2026-07-12T10:00:00Z');
    await turn('op-running', '2026-07-12T11:00:00Z');
    await turn('op-waiting', '2026-07-12T10:30:00Z');
    await turn('op-done', '2026-07-12T10:45:00Z'); // settled
    await turn('op-old', '2026-07-11T10:00:00Z'); // before the cutoff
    await turn('op-other', '2026-07-12T10:50:00Z', other.id); // another account

    const runs = await ledger.listActiveRuns(account.id, new Date('2026-07-12T00:00:00Z'));

    expect(runs.map((r) => r.operationId)).toEqual(['op-running', 'op-waiting']);
    expect(runs[0]).toMatchObject({
      agentId,
      agentTitle: 'Builder',
      status: 'running',
      topicId: 'quota-topic',
      topicTitle: 'Fix login',
    });
    expect(runs[0].lastTurnAt).toEqual(new Date('2026-07-12T11:00:00Z'));
  });

  it('sumCostUsd returns 0 when nothing matches', async () => {
    expect(
      await ledger.sumCostUsd('00000000-0000-0000-0000-000000000000', new Date(0), new Date()),
    ).toBe(0);
  });

  it('latest calibration returns null when no bucket matches', async () => {
    expect(
      await calibrations.latest('00000000-0000-0000-0000-000000000000', 'session', ''),
    ).toBeNull();
  });
});
