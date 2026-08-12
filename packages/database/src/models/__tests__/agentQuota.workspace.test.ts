// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentProviderAccounts, agents, users, workspaces } from '../../schemas';
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

const userId = 'agent-quota-workspace-user';
const teammateId = 'agent-quota-workspace-teammate';
const workspaceId = 'agent-quota-workspace';
/** Personal-scope agent (workspaceId null). */
const agentId = 'agent-quota-personal-agent';
/** Workspace-scope agent — a distinct row, as agents belong to exactly one scope. */
const wsAgentId = 'agent-quota-shared-agent';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: teammateId }]);
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'Agent Quota Workspace',
    primaryOwnerId: userId,
    slug: workspaceId,
  });
  await serverDB.insert(agents).values([
    { id: agentId, userId },
    { id: wsAgentId, userId, workspaceId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('Agent quota workspace scope', () => {
  it('isolates accounts and bindings between personal and workspace mode', async () => {
    const personalAccounts = new AgentProviderAccountModel(serverDB, userId);
    const workspaceAccounts = new AgentProviderAccountModel(serverDB, userId, workspaceId);

    const personal = await personalAccounts.create({
      credentialMode: 'referenced',
      label: 'Personal 20x',
      provider: 'claude-code',
    });
    const shared = await workspaceAccounts.create({
      credentialMode: 'referenced',
      label: 'Team 20x',
      provider: 'claude-code',
    });

    // the workspace id is stamped from the model, not the caller payload
    const sharedRow = await serverDB.query.agentProviderAccounts.findFirst({
      where: eq(agentProviderAccounts.id, shared.id),
    });
    expect(sharedRow?.workspaceId).toBe(workspaceId);
    const personalRow = await serverDB.query.agentProviderAccounts.findFirst({
      where: eq(agentProviderAccounts.id, personal.id),
    });
    expect(personalRow?.workspaceId).toBeNull();

    // neither side sees the other
    expect((await personalAccounts.list()).map((a) => a.id)).toEqual([personal.id]);
    expect((await workspaceAccounts.list()).map((a) => a.id)).toEqual([shared.id]);
    expect(await personalAccounts.findById(shared.id)).toBeNull();
    expect(await workspaceAccounts.findById(personal.id)).toBeNull();

    const personalBindings = new AgentAccountBindingModel(serverDB, userId);
    const workspaceBindings = new AgentAccountBindingModel(serverDB, userId, workspaceId);
    await personalBindings.upsert({ accountId: personal.id, agentId, role: 'pinned' });
    await workspaceBindings.upsert({ accountId: shared.id, agentId: wsAgentId, role: 'pinned' });

    const workspaceList = await workspaceBindings.listByAgent(wsAgentId);
    expect(workspaceList.map((b) => b.accountId)).toEqual([shared.id]);
    expect(workspaceList[0].workspaceId).toBe(workspaceId);

    // a personal-mode read must not reach a workspace binding, and vice versa
    expect(await personalBindings.listByAgent(wsAgentId)).toEqual([]);
    expect(await workspaceBindings.listByAgent(agentId)).toEqual([]);

    // …but a teammate reading in the same workspace does see it (shared by design)
    const teammateBindings = new AgentAccountBindingModel(serverDB, teammateId, workspaceId);
    expect((await teammateBindings.listByAgent(wsAgentId)).map((b) => b.accountId)).toEqual([
      shared.id,
    ]);
    const teammateAccounts = new AgentProviderAccountModel(serverDB, teammateId, workspaceId);
    expect((await teammateAccounts.list()).map((a) => a.id)).toEqual([shared.id]);
    // the teammate still cannot reach the owner's personal account
    expect(await new AgentProviderAccountModel(serverDB, teammateId).list()).toEqual([]);
  });

  it('scopes the observation tables (snapshots, ledger, windows, calibrations)', async () => {
    const workspaceAccounts = new AgentProviderAccountModel(serverDB, userId, workspaceId);
    const account = await workspaceAccounts.create({
      credentialMode: 'referenced',
      provider: 'claude-code',
    });

    const capturedAt = new Date('2026-07-01T00:00:00Z');
    const resetsAt = new Date('2026-07-01T05:00:00Z');

    const personalSnapshots = new AgentQuotaSnapshotModel(serverDB, userId);
    const workspaceSnapshots = new AgentQuotaSnapshotModel(serverDB, userId, workspaceId);
    await workspaceSnapshots.append([
      { accountId: account.id, capturedAt, limitType: 'session', utilization: 42 },
    ]);
    expect(await workspaceSnapshots.latestPerBucket(account.id)).toHaveLength(1);
    expect(await personalSnapshots.latestPerBucket(account.id)).toHaveLength(0);

    const personalLedger = new AgentQuotaUsageLedgerModel(serverDB, userId);
    const workspaceLedger = new AgentQuotaUsageLedgerModel(serverDB, userId, workspaceId);
    await workspaceLedger.append({
      accountId: account.id,
      costUsd: 1.25,
      occurredAt: capturedAt,
      provider: 'claude-code',
    });
    expect(await workspaceLedger.sumCostUsd(account.id, capturedAt, resetsAt)).toBe(1.25);
    expect(await personalLedger.sumCostUsd(account.id, capturedAt, resetsAt)).toBe(0);

    const personalWindows = new AgentQuotaWindowModel(serverDB, userId);
    const workspaceWindows = new AgentQuotaWindowModel(serverDB, userId, workspaceId);
    await workspaceWindows.upsert({
      accountId: account.id,
      limitType: 'session',
      peakUtilization: 42,
      resetsAt,
      windowSeconds: 18_000,
      windowStartAt: capturedAt,
    });
    expect(await workspaceWindows.listByAccount(account.id)).toHaveLength(1);
    expect(await personalWindows.listByAccount(account.id)).toHaveLength(0);

    const personalCalibrations = new AgentQuotaCalibrationModel(serverDB, userId);
    const workspaceCalibrations = new AgentQuotaCalibrationModel(serverDB, userId, workspaceId);
    await workspaceCalibrations.insert({
      accountId: account.id,
      capacityUsd: 80,
      limitType: 'weekly_all',
      sampleCount: 5,
    });
    expect(await workspaceCalibrations.latest(account.id, 'weekly_all')).not.toBeNull();
    expect(await personalCalibrations.latest(account.id, 'weekly_all')).toBeNull();
  });

  it('lets the same external identity exist once per scope', async () => {
    const identity = { externalAccountId: 'ext-acc-1', email: 'a@b.com' };
    const personalAccounts = new AgentProviderAccountModel(serverDB, userId);
    const workspaceAccounts = new AgentProviderAccountModel(serverDB, userId, workspaceId);

    const personal = await personalAccounts.upsertByIdentity('claude-code', identity);
    const shared = await workspaceAccounts.upsertByIdentity('claude-code', identity);
    expect(shared.id).not.toBe(personal.id);

    // re-observing the same identity in the same scope dedupes instead of inserting
    const again = await workspaceAccounts.upsertByIdentity('claude-code', identity);
    expect(again.id).toBe(shared.id);
    expect(await workspaceAccounts.list()).toHaveLength(1);
    expect(await personalAccounts.list()).toHaveLength(1);

    // …and so does a teammate observing it from their own device: one real
    // account must stay ONE row per workspace, or the load balancer would count
    // its capacity twice.
    const teammateAccounts = new AgentProviderAccountModel(serverDB, teammateId, workspaceId);
    const fromTeammate = await teammateAccounts.upsertByIdentity('claude-code', identity);
    expect(fromTeammate.id).toBe(shared.id);
    expect(await workspaceAccounts.list()).toHaveLength(1);
  });
});
