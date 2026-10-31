// @vitest-environment node
import { createHash } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentInterventions, agentOperations, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import * as agentInterventionModule from '../agentIntervention';
import { AgentInterventionModel } from '../agentIntervention';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'agent-intervention-surface-owner';
const otherUserId = 'agent-intervention-surface-other';
const workspaceId = 'agent-intervention-surface-workspace';
const operationId = 'agent-intervention-surface-operation';

const model = new AgentInterventionModel(serverDB, ownerId, workspaceId);

const createBatch = (batchId: string) =>
  model.createBatch({
    activityKey: `activity-${batchId}`,
    batchId,
    deadline: new Date(Date.now() + 10 * 60_000),
    items: [
      {
        allowedActions: ['submit_answers', 'skip_interaction', 'cancel_interaction'],
        interactionKind: 'question',
        provider: 'claude-code',
        requestRevisionHash: 'b'.repeat(64),
        reviewContext: { summary: 'Choose a mode', title: 'Agent needs your input' },
        reviewTokenHash: createHash('sha256').update(batchId).digest('hex'),
        sanitizedRequest: {
          apiName: 'askUserQuestion',
          identifier: 'claude-code',
          questions: [{ id: 'mode', options: [{ id: 'safe', label: 'Safe' }], question: 'Mode?' }],
        },
        surface: 'form',
        toolCallId: `tool-${batchId}`,
      },
    ],
    operationId,
    provider: 'claude-code',
    source: 'heterogeneous',
    stepIndex: 0,
    systemActionEligibility: 'review_only',
  });

beforeEach(async () => {
  await serverDB.delete(agentInterventions);
  await serverDB.delete(agentOperations);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: ownerId }, { id: otherUserId }]);
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'Surface workspace',
    primaryOwnerId: ownerId,
    slug: workspaceId,
  });
  await serverDB
    .insert(agentOperations)
    .values({ id: operationId, status: 'running', userId: ownerId, workspaceId });
});

/**
 * Pins the public surface of `AgentInterventionModel` so a split into helper
 * modules keeps every caller-visible name. Methods are instance arrow fields,
 * so they are read off an instance rather than the prototype.
 */
describe('AgentInterventionModel public surface', () => {
  it('keeps the module exports', () => {
    expect(Object.keys(agentInterventionModule).sort()).toEqual([
      'AGENT_INTERVENTION_CUSTOM_EXECUTION_MAX_LEASE_MS',
      'AGENT_INTERVENTION_CUSTOM_EXECUTION_MIN_LEASE_MS',
      'AGENT_INTERVENTION_IDENTITY_CONFLICT',
      'AGENT_INTERVENTION_INVALID_ACTION',
      'AGENT_INTERVENTION_INVALID_BATCH',
      'AGENT_INTERVENTION_INVALID_REQUEST_REVISION_HASH',
      'AGENT_INTERVENTION_INVALID_REVIEW_TOKEN_HASH',
      'AGENT_INTERVENTION_RESOLUTION_REQUEST_REUSED',
      'AGENT_INTERVENTION_SOURCE_TRANSITION_MISMATCH',
      'AgentInterventionModel',
      'hashAgentInterventionRequestRevision',
    ]);
  });

  it('keeps every public instance method and static locator', () => {
    const instance = model as unknown as Record<string, unknown>;
    const missing = [
      'acknowledgeProducerResolution',
      'claimBatch',
      'claimCustomExecution',
      'completeCustomExecution',
      'completeMcpResolution',
      'completeRuntimeResolution',
      'createBatch',
      'createBatchWithSupersession',
      'findBatch',
      'findById',
      'findByIdForOwner',
      'findByReviewTokenHash',
      'findResolutionByRequestId',
      'markBatchTerminal',
      'markResolutionPublished',
      'recordProducerAck',
      'rollbackResolution',
    ].filter((name) => typeof instance[name] !== 'function');
    expect(missing).toEqual([]);

    const statics = AgentInterventionModel as unknown as Record<string, unknown>;
    expect(
      ['locateByOperationAndToolCall', 'locateByResolutionRequestId', 'locateByReviewTokenHash']
        .map((name) => typeof statics[name])
        .every((type) => type === 'function'),
    ).toBe(true);
  });
});

// `findById` had no direct test before the split.
describe('AgentInterventionModel.findById', () => {
  it('returns rows in scope and nothing for malformed ids or other users', async () => {
    const [row] = await createBatch('find-by-id');

    expect(await model.findById(row.id)).toMatchObject({ id: row.id, status: 'pending' });
    expect(await model.findById('not-a-uuid')).toBeUndefined();
    expect(
      await new AgentInterventionModel(serverDB, otherUserId, workspaceId).findById(row.id),
    ).toBeUndefined();
  });

  it('times out an open row whose deadline has passed', async () => {
    const [row] = await createBatch('find-by-id-expired');
    await serverDB
      .update(agentInterventions)
      .set({ deadline: new Date(Date.now() - 1000) })
      .where(eq(agentInterventions.id, row.id));

    expect(await model.findById(row.id)).toMatchObject({ id: row.id, status: 'timed_out' });
  });
});
