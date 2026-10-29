// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentCronJobModel } from '../agentCronJob';
import { createProxyTestDB } from './_proxyTestDB';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-cron-cov-user';
const agentId = 'agent-cron-cov-agent';

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(agents).values({ id: agentId, userId });
});

afterEach(async () => {
  // Cron jobs cascade with their agent and owner.
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

describe('AgentCronJobModel coverage', () => {
  /**
   * `sum()` is bigint, which the drivers hand back in different shapes; the proxy delivers the
   * pending-executions cell as a number, the shape the unlimited-job sentinel compares against.
   */
  it('reports no pending executions for a lone unlimited job', async () => {
    await new AgentCronJobModel(serverDB, userId).create({
      agentId,
      content: 'unlimited',
      cronPattern: '0 * * * *',
    });
    const numericSums = createProxyTestDB(serverDB, (_query, result) =>
      result.rows.map((row) => row.map((cell) => (cell === null ? null : Number(cell)))),
    );

    const stats = await new AgentCronJobModel(numericSums, userId).getExecutionStats();

    expect(stats).toEqual({
      activeJobs: 1,
      completedExecutions: 0,
      pendingExecutions: 0,
      totalJobs: 1,
    });
  });
});
