// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import type { LobeChatDatabase } from '../../type';
import { AgentQuotaUsageLedgerModel } from '../agentQuota';
import { createProxyTestDB } from './_proxyTestDB';

const serverDB: LobeChatDatabase = await getTestDB();

describe('AgentQuotaUsageLedgerModel coverage', () => {
  it('reports zero spend when the cost aggregate yields no row', async () => {
    const ledger = new AgentQuotaUsageLedgerModel(
      createProxyTestDB(serverDB, () => []),
      'agent-quota-cov-user',
    );

    expect(await ledger.sumCostUsd(randomUUID(), new Date(0), new Date())).toBe(0);
  });
});
