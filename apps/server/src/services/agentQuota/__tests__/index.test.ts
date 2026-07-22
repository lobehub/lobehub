// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import type { QuotaLimitReading } from '@lobechat/heterogeneous-agents/quota';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AgentQuotaCalibrationModel,
  AgentQuotaUsageLedgerModel,
  AgentQuotaWindowModel,
} from '@/database/models/agentQuota';
import { users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { AgentQuotaService } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-quota-service-user';
const identity = { email: 'a@example.com', externalAccountId: 'acc-uuid-1' };
const HOUR = 3_600_000;

/** Four clean 5h windows at ~$5.5 of spend per utilization point. */
const samples = [
  { cost: 142, start: Date.parse('2026-07-01T00:00:00Z'), util: 26 },
  { cost: 300, start: Date.parse('2026-07-01T05:00:00Z'), util: 55 },
  { cost: 210, start: Date.parse('2026-07-01T10:00:00Z'), util: 38 },
  { cost: 90, start: Date.parse('2026-07-01T15:00:00Z'), util: 16 },
];

const readings: QuotaLimitReading[] = samples.flatMap((s) => {
  const resetsAt = s.start + 5 * HOUR;
  // two readings per window, rising utilization (monotonic within a window)
  return [
    {
      capturedAt: s.start + HOUR,
      limitType: 'session',
      resetsAt,
      scopeKey: '',
      utilization: Math.round(s.util / 2),
    },
    {
      capturedAt: s.start + 4 * HOUR,
      limitType: 'session',
      resetsAt,
      scopeKey: '',
      utilization: s.util,
    },
  ];
});

let service: AgentQuotaService;
let calibrations: AgentQuotaCalibrationModel;
let ledger: AgentQuotaUsageLedgerModel;
let windows: AgentQuotaWindowModel;

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  service = new AgentQuotaService(serverDB, userId);
  calibrations = new AgentQuotaCalibrationModel(serverDB, userId);
  ledger = new AgentQuotaUsageLedgerModel(serverDB, userId);
  windows = new AgentQuotaWindowModel(serverDB, userId);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('AgentQuotaService.ingestSnapshot', () => {
  it('calibrates capacity from the ingested windows once ledger spend exists', async () => {
    // 1) first ingest creates the account (and cannot calibrate yet)
    const account = await service.ingestSnapshot({
      identity,
      provider: 'claude-code',
      readings: [],
    });

    // 2) our own per-turn spend, the other half of the Δutil ↔ Δcost pair
    for (const [i, s] of samples.entries()) {
      await ledger.append({
        accountId: account.id,
        costUsd: s.cost,
        externalEventId: `turn-${i}`,
        model: 'claude-opus-4-8',
        occurredAt: new Date(s.start + 2 * HOUR),
        provider: 'claude-code',
      });
    }

    // 3) the real production path: readings in → windows + calibration out
    await service.ingestSnapshot({ identity, provider: 'claude-code', readings });

    expect(await windows.listByAccount(account.id)).toHaveLength(4);

    const latest = await calibrations.latest(account.id, 'session');
    expect(latest).not.toBeNull();
    // ~$5.5 per utilization point → ~$550 for a full window
    expect(Number(latest!.capacityUsd)).toBeGreaterThan(450);
    expect(Number(latest!.capacityUsd)).toBeLessThan(650);
    expect(latest!.sampleCount).toBeGreaterThanOrEqual(3);
  });

  it('writes no calibration when nothing recorded our spend', async () => {
    // Guards the inverse: with an empty ledger every window reads as "meter moved
    // but we spent nothing" → contaminated → excluded, so we emit no capacity
    // rather than a fabricated one. This is why the ledger writer must land
    // before calibration produces anything in production.
    const account = await service.ingestSnapshot({ identity, provider: 'claude-code', readings });

    expect(await windows.listByAccount(account.id)).toHaveLength(4);
    expect(await calibrations.latest(account.id, 'session')).toBeNull();
  });
});
