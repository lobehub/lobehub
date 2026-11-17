// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AgentAccountBindingModel,
  AgentProviderAccountLoginModel,
  AgentProviderAccountModel,
} from '@/database/models/agentQuota';
import { agents, devices, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { QuotaBindingRole } from '@/database/types/agentQuota';

import { AgentQuotaService, QuotaAccountNotFoundError } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-quota-authz-service-user';
const HOUR = 3_600_000;
const now = Date.parse('2026-11-12T00:00:00Z');

const weekly = (utilization: number) => ({
  capturedAt: now - 60_000,
  limitType: 'weekly_all',
  resetsAt: now + 3 * 24 * HOUR,
  scopeKey: '',
  utilization,
});

let service: AgentQuotaService;
let bindings: AgentAccountBindingModel;

const account = (externalAccountId: string, utilization = 20, provider = 'claude-code') =>
  service.ingestSnapshot({
    identity: { email: `${externalAccountId}@example.com`, externalAccountId },
    provider: provider as 'claude-code',
    readings: [weekly(utilization)],
  });

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(agents).values([
    { id: 'agent-a', slug: 'agent-a', title: 'A', userId },
    { id: 'agent-b', slug: 'agent-b', title: 'B', userId },
  ]);
  service = new AgentQuotaService(serverDB, userId);
  bindings = new AgentAccountBindingModel(serverDB, userId);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('AgentQuotaService authorized accounts', () => {
  it('lists the global pool with each account marked authorized for the agent', async () => {
    const x = await account('x');
    const y = await account('y');
    const codex = await account('cx', 20, 'codex');
    await bindings.upsert({ accountId: x.id, agentId: 'agent-a', role: QuotaBindingRole.pool });
    await bindings.upsert({ accountId: y.id, agentId: 'agent-a', role: QuotaBindingRole.disabled });

    const listed = await service.listAgentAccounts('agent-a', 'claude-code');
    expect(
      Object.fromEntries(listed.map((a) => [a.externalAccountId, [a.authorized, a.role]])),
    ).toEqual({ x: [true, 'pool'], y: [false, 'disabled'] });
    expect(listed.some((a) => a.id === codex.id)).toBe(false);
    expect(listed.every((a) => !('credentials' in a))).toBe(true);
  });

  it('sets the authorized set and reports it as the Auto candidates', async () => {
    const x = await account('x');
    const y = await account('y');
    const z = await account('z');

    const config = await service.setAgentAccounts('agent-a', [x.id, y.id], 'claude-code');
    expect(config).toEqual({
      authorizedAccountIds: expect.arrayContaining([x.id, y.id]),
      candidateAccountIds: expect.arrayContaining([x.id, y.id]),
      mode: 'auto',
      pinScope: null,
      pinnedAccountId: null,
    });
    expect(config.authorizedAccountIds).toHaveLength(2);
    expect(config.candidateAccountIds).not.toContain(z.id);
  });

  it('rejects an account the caller cannot see and writes nothing', async () => {
    const x = await account('x');
    const codex = await account('cx', 20, 'codex');

    const error = await service
      .setAgentAccounts('agent-a', [x.id, codex.id], 'claude-code')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QuotaAccountNotFoundError);
    expect((error as QuotaAccountNotFoundError).accountIds).toEqual([codex.id]);
    expect(await bindings.listByAgent('agent-a')).toEqual([]);
  });

  it('reports Manual mode for a pin and keeps disabled accounts out of the candidates', async () => {
    const x = await account('x');
    const y = await account('y');
    await service.setAgentAccounts('agent-a', [x.id, y.id], 'claude-code');
    await new AgentProviderAccountModel(serverDB, userId).update(y.id, { enabled: false });
    await bindings.pin('agent-a', x.id);

    expect(await service.getLoadBalanceConfig('agent-a', { provider: 'claude-code' })).toEqual({
      authorizedAccountIds: expect.arrayContaining([x.id, y.id]),
      candidateAccountIds: [x.id],
      mode: 'manual',
      pinScope: 'agent',
      pinnedAccountId: x.id,
    });
  });
});

describe('AgentQuotaService.selectForAgent — authorized candidates and rotation', () => {
  it('never selects an unauthorized account, even with more headroom', async () => {
    const mine = await account('mine', 80);
    await account('global-free', 0);
    await service.setAgentAccounts('agent-a', [mine.id], 'claude-code');

    for (let i = 0; i < 3; i++)
      expect(
        (await service.selectForAgent('agent-a', { now: now + i, provider: 'claude-code' }))
          ?.accountId,
      ).toBe(mine.id);
  });

  it('rotates consecutive runs across the authorized accounts', async () => {
    const x = await account('x', 10);
    const y = await account('y', 30);
    const z = await account('z', 50);
    await service.setAgentAccounts('agent-a', [x.id, y.id, z.id], 'claude-code');

    const picks: (string | undefined)[] = [];
    for (let i = 0; i < 6; i++)
      picks.push(
        (await service.selectForAgent('agent-a', { now: now + i, provider: 'claude-code' }))
          ?.externalAccountId ?? undefined,
      );
    expect(picks).toEqual(['x', 'y', 'z', 'x', 'y', 'z']);
  });

  it('spreads concurrent selections of one agent across its accounts', async () => {
    const x = await account('x', 10);
    const y = await account('y', 30);
    await service.setAgentAccounts('agent-a', [x.id, y.id], 'claude-code');

    // Open the connections first, so the selections really overlap instead of
    // being staggered by connection setup.
    await Promise.all(
      Array.from({ length: 8 }, () => serverDB.execute(sql`select pg_sleep(0.05)`)),
    );
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        // each request is its own service, like separate tRPC calls
        new AgentQuotaService(serverDB, userId).selectForAgent('agent-a', {
          provider: 'claude-code',
        }),
      ),
    );
    const counts = results.reduce<Record<string, number>>((acc, r) => {
      const key = r?.externalAccountId ?? 'none';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ x: 3, y: 3 });
  });

  it('keeps agents sharing an account independent', async () => {
    const shared = await account('shared', 10);
    const aOnly = await account('a-only', 30);
    await service.setAgentAccounts('agent-a', [shared.id, aOnly.id], 'claude-code');
    await service.setAgentAccounts('agent-b', [shared.id], 'claude-code');

    // A uses the shared account first; B's rotation state is untouched by it.
    expect(
      (await service.selectForAgent('agent-a', { now, provider: 'claude-code' }))?.accountId,
    ).toBe(shared.id);
    expect(
      (await service.selectForAgent('agent-b', { now: now + 1, provider: 'claude-code' }))
        ?.accountId,
    ).toBe(shared.id);
    expect(
      (await service.selectForAgent('agent-a', { now: now + 2, provider: 'claude-code' }))
        ?.accountId,
    ).toBe(aOnly.id);

    // B dropping the shared account leaves A's authorization in place.
    await service.setAgentAccounts('agent-b', [], 'claude-code');
    expect(
      (await service.getLoadBalanceConfig('agent-a', { provider: 'claude-code' }))
        .authorizedAccountIds,
    ).toEqual(expect.arrayContaining([shared.id, aOnly.id]));
    expect(await service.selectForAgent('agent-b', { provider: 'claude-code' })).toBeNull();
  });

  it('runs every run on a single authorized account until it is spent', async () => {
    const only = await account('only', 40);
    await service.setAgentAccounts('agent-a', [only.id], 'claude-code');

    for (let i = 0; i < 3; i++)
      expect(
        (await service.selectForAgent('agent-a', { now: now + i, provider: 'claude-code' }))
          ?.accountId,
      ).toBe(only.id);

    await service.ingestSnapshot({
      identity: { externalAccountId: 'only' },
      provider: 'claude-code',
      readings: [{ ...weekly(100), capturedAt: now + 10 }],
    });
    expect(
      await service.selectForAgent('agent-a', { now: now + 20, provider: 'claude-code' }),
    ).toBeNull();
  });

  it('rotates the device routing candidates too', async () => {
    const x = await account('x', 10);
    const y = await account('y', 30);
    await service.setAgentAccounts('agent-a', [x.id, y.id], 'claude-code');

    const first = await service.planDeviceRouting('agent-a', { now, provider: 'claude-code' });
    const second = await service.planDeviceRouting('agent-a', {
      now: now + 1,
      provider: 'claude-code',
    });
    expect(first?.candidates.map((c) => c.externalAccountId)).toEqual(['x', 'y']);
    expect(second?.candidates.map((c) => c.externalAccountId)).toEqual(['y', 'x']);
  });

  it('rotates on the accounts the run device is signed in to, not on ones it cannot run', async () => {
    const elsewhere = await account('elsewhere', 0);
    const b = await account('b', 10);
    const c = await account('c', 20);
    await service.setAgentAccounts('agent-a', [elsewhere.id, b.id, c.id], 'claude-code');
    const [device] = await serverDB
      .insert(devices)
      .values({ deviceId: 'authz-device', identitySource: 'stable', userId })
      .returning();
    const logins = new AgentProviderAccountLoginModel(serverDB, userId);
    await logins.record(b.id, device.id);
    await logins.record(c.id, device.id);

    const picks: (string | null | undefined)[] = [];
    for (let i = 0; i < 4; i++)
      picks.push(
        (
          await service.selectForAgent('agent-a', {
            deviceId: device.id,
            now: now + i,
            provider: 'claude-code',
          })
        )?.externalAccountId,
      );
    expect(picks).toEqual(['b', 'c', 'b', 'c']);

    // The device routing stamps what the device will run, too.
    const routed: string[] = [];
    for (let i = 10; i < 14; i++) {
      const plan = await service.planDeviceRouting('agent-a', {
        deviceId: device.id,
        now: now + i,
        provider: 'claude-code',
      });
      routed.push(
        plan!.candidates.find((candidate) => ['b', 'c'].includes(candidate.externalAccountId))!
          .externalAccountId,
      );
    }
    expect(routed).toEqual(['b', 'c', 'b', 'c']);
  });
});
