// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agentInterventionResolutions,
  agentInterventions,
  agentOperations,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { type ArrayQueryResult, columnIndex, createProxyTestDB } from '../__tests__/_proxyTestDB';
import { AgentInterventionModel } from './index';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'ce-guards-owner';
const actorId = 'ce-guards-actor';
const workspaceId = 'ce-guards-workspace';
const operationId = 'ce-guards-operation';

const model = new AgentInterventionModel(serverDB, ownerId, workspaceId);

const inputHash = 'b'.repeat(64);
const leaseDurationMs = 60_000;
const now = new Date('2026-08-26T10:00:00.000Z');

let sequence = 0;
const nextHash = () => (++sequence).toString(16).padStart(64, 'a');

/** A resolved `submit_custom` intervention whose private execution ledger starts out pending. */
const createCustomResolution = async () => {
  const [row] = await model.createBatch({
    activityKey: `ce-guards-activity-${++sequence}`,
    batchId: `ce-guards-batch-${sequence}`,
    deadline: new Date(Date.now() + 10 * 60_000),
    items: [
      {
        allowedActions: ['submit_custom'],
        interactionKind: 'custom',
        provider: 'claude-code',
        requestRevisionHash: nextHash(),
        reviewContext: { summary: 'Install it', title: 'Agent needs your input' },
        reviewTokenHash: nextHash(),
        sanitizedRequest: {
          apiName: 'installMarketplaceItem',
          fields: [{ id: 'confirm', label: 'Install', required: true, type: 'boolean' }],
        },
        surface: 'form',
        toolCallId: `ce-guards-tool-${sequence}`,
      },
    ],
    operationId,
    provider: 'claude-code',
    source: 'heterogeneous',
    stepIndex: 0,
    systemActionEligibility: 'review_only',
  });
  const claimed = await model.claimBatch({
    action: {
      expectedRevisionHash: row.requestRevisionHash,
      result: { confirm: true },
      type: 'submit_custom',
    },
    actorId,
    batchId: row.batchId,
    expectedItemCount: 1,
    expectedRequestRevisionHashes: { [row.id]: row.requestRevisionHash },
    expectedVersions: { [row.id]: row.version },
    operationId: row.operationId,
    resolutionRequestId: randomUUID(),
    scope: 'single',
    selectedInterventionIds: [row.id],
  });
  if (claimed.outcome !== 'applied') throw new Error('custom resolution claim failed');
  return claimed.resolution;
};

const readLedger = async (resolutionRequestId: string) => {
  const [row] = await serverDB
    .select()
    .from(agentInterventionResolutions)
    .where(eq(agentInterventionResolutions.resolutionRequestId, resolutionRequestId));
  return row;
};

/**
 * A model whose locked read of the resolution row returns `patch` applied to the real row —
 * the shape a relaxed CHECK constraint or a write between the read and the UPDATE would leave.
 * Every statement, the UPDATE included, still runs against the real row.
 */
const modelSeeing = (patch: Record<string, unknown>) =>
  new AgentInterventionModel(
    createProxyTestDB(serverDB, (query, result: ArrayQueryResult) => {
      if (!query.includes('from "agent_intervention_resolutions"') || !query.includes('for update'))
        return result.rows;
      return result.rows.map((row) => {
        const next = [...row];
        for (const [name, value] of Object.entries(patch)) next[columnIndex(result, name)] = value;
        return next;
      });
    }),
    ownerId,
    workspaceId,
  );

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: ownerId }, { id: actorId }]);
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'Custom execution guards',
    primaryOwnerId: ownerId,
    slug: 'ce-guards-workspace',
  });
  await serverDB
    .insert(agentOperations)
    .values({ id: operationId, status: 'running', userId: ownerId, workspaceId });
});

afterEach(async () => {
  await serverDB.delete(agentInterventions).where(eq(agentInterventions.userId, ownerId));
  await serverDB
    .delete(agentInterventionResolutions)
    .where(eq(agentInterventionResolutions.userId, ownerId));
  await serverDB.delete(agentOperations).where(eq(agentOperations.id, operationId));
  await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await serverDB.delete(users).where(inArray(users.id, [ownerId, actorId]));
});

describe('claimCustomExecution guards', () => {
  it('refuses an executing row that carries no lease token instead of reporting a live lease', async () => {
    const resolution = await createCustomResolution();
    const params = {
      inputHash,
      leaseDurationMs,
      resolutionRequestId: resolution.resolutionRequestId,
    };
    expect(await model.claimCustomExecution(params, now)).toMatchObject({ outcome: 'applied' });
    const before = await readLedger(resolution.resolutionRequestId);

    // Without the token the lease cannot be fenced; the same read with the token is `in_progress`.
    const result = await modelSeeing({ custom_execution_lease_token: null }).claimCustomExecution(
      params,
      new Date(now.getTime() + 1000),
    );

    expect(result).toEqual({ outcome: 'conflict' });
    expect(await readLedger(resolution.resolutionRequestId)).toEqual(before);
  });

  it('refuses a ledger state the CHECK constraint does not know instead of claiming it', async () => {
    const resolution = await createCustomResolution();

    const result = await modelSeeing({
      custom_execution_state: 'abandoned',
    }).claimCustomExecution(
      { inputHash, leaseDurationMs, resolutionRequestId: resolution.resolutionRequestId },
      now,
    );

    expect(result).toEqual({ outcome: 'conflict' });
    expect(await readLedger(resolution.resolutionRequestId)).toMatchObject({
      customExecutionAttempt: 0,
      customExecutionLeaseToken: null,
      customExecutionState: 'pending',
    });
  });

  it('reports a conflict, never a lease, when the resolving row is gone by the time of the UPDATE', async () => {
    const resolution = await createCustomResolution();
    expect((await model.rollbackResolution(resolution.resolutionRequestId)).outcome).toBe(
      'applied',
    );

    // The locked read still sees `resolving`; the UPDATE's own status filter sees the rollback.
    const result = await modelSeeing({ status: 'resolving' }).claimCustomExecution(
      { inputHash, leaseDurationMs, resolutionRequestId: resolution.resolutionRequestId },
      now,
    );

    expect(result).toEqual({ outcome: 'conflict' });
    expect(result).not.toHaveProperty('leaseToken');
    expect(await readLedger(resolution.resolutionRequestId)).toMatchObject({
      customExecutionAttempt: 0,
      customExecutionState: 'pending',
      status: 'rolled_back',
    });
  });
});

describe('completeCustomExecution guards', () => {
  it('reports a conflict when the lease was taken over between the locked read and the UPDATE', async () => {
    const resolution = await createCustomResolution();
    const claimed = await model.claimCustomExecution(
      { inputHash, leaseDurationMs, resolutionRequestId: resolution.resolutionRequestId },
      now,
    );
    if (claimed.outcome !== 'applied') throw new Error('execution lease claim failed');
    const takeover = randomUUID();
    await serverDB
      .update(agentInterventionResolutions)
      .set({ customExecutionLeaseToken: takeover })
      .where(eq(agentInterventionResolutions.id, resolution.id));

    // The locked read still shows the stale token; the UPDATE filters on the current one.
    const result = await modelSeeing({
      custom_execution_lease_token: claimed.leaseToken,
    }).completeCustomExecution({
      inputHash,
      leaseToken: claimed.leaseToken,
      resolutionRequestId: resolution.resolutionRequestId,
      result: { content: 'Installed' },
    });

    expect(result).toEqual({ outcome: 'conflict' });
    expect(await readLedger(resolution.resolutionRequestId)).toMatchObject({
      customExecutionLeaseToken: takeover,
      customExecutionResult: null,
      customExecutionState: 'executing',
    });
  });
});
