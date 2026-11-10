// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { eq, inArray, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import type { AgentInterventionItem } from '../../schemas';
import {
  agentInterventionResolutions,
  agentInterventions,
  agentOperations,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  AGENT_INTERVENTION_IDENTITY_CONFLICT,
  AGENT_INTERVENTION_INVALID_ACTION,
  AGENT_INTERVENTION_INVALID_BATCH,
  AGENT_INTERVENTION_INVALID_REQUEST_REVISION_HASH,
  AGENT_INTERVENTION_INVALID_REVIEW_TOKEN_HASH,
  AGENT_INTERVENTION_SOURCE_TRANSITION_MISMATCH,
  AgentInterventionModel,
} from '../agentIntervention';
import type { AgentInterventionContext } from '../agentIntervention/context';
import {
  markRowsTerminalInTransaction,
  withLazyTimeout,
  withOwnerLazyTimeout,
} from '../agentIntervention/lookup';
import { lockAndTransitionResolution } from '../agentIntervention/resolution';
import { createProxyTestDB } from './_proxyTestDB';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 't874-ai-owner';
const workspaceId = 't874-ai-workspace';
const operationId = 't874-ai-operation';
const personalOperationId = 't874-ai-personal-operation';

const model = new AgentInterventionModel(serverDB, ownerId, workspaceId);
const personalModel = new AgentInterventionModel(serverDB, ownerId);
const workspaceCtx: AgentInterventionContext = { db: serverDB, userId: ownerId, workspaceId };
const personalCtx: AgentInterventionContext = { db: serverDB, userId: ownerId };

let hashSequence = 0;
const nextHash = () => (++hashSequence).toString(16).padStart(64, 'b');

type CreateParams = Parameters<typeof model.createBatch>[0];
type CreateItem = CreateParams['items'][number];

const questionItem = (overrides: Partial<CreateItem> = {}): CreateItem => ({
  allowedActions: ['submit_answers', 'skip_interaction', 'cancel_interaction'],
  interactionKind: 'question',
  requestRevisionHash: nextHash(),
  reviewContext: { title: 'Agent needs your input' },
  reviewTokenHash: nextHash(),
  sanitizedRequest: {
    apiName: 'askUserQuestion',
    questions: [{ id: 'mode', options: [{ id: 'safe', label: 'Safe' }], question: 'Mode?' }],
  },
  surface: 'form',
  toolCallId: `t874-question-${hashSequence}`,
  ...overrides,
});

const customItem = (): CreateItem =>
  questionItem({
    allowedActions: ['submit_custom'],
    interactionKind: 'custom',
    sanitizedRequest: {
      apiName: 'installMarketplaceItem',
      fields: [{ id: 'confirm', label: 'Install', required: true, type: 'boolean' }],
    },
  });

const batchParams = (overrides: Partial<CreateParams> = {}): CreateParams => ({
  activityKey: `t874-activity-${hashSequence + 1}`,
  batchId: `t874-batch-${hashSequence + 1}`,
  deadline: new Date(Date.now() + 10 * 60_000),
  items: [questionItem()],
  operationId,
  provider: 'claude-code',
  source: 'heterogeneous',
  stepIndex: 0,
  systemActionEligibility: 'review_only',
  ...overrides,
});

const createBatch = (overrides: Partial<CreateParams> = {}, target = model) =>
  target.createBatch(batchParams(overrides));

const claim = (
  rows: AgentInterventionItem[],
  action: Parameters<typeof model.claimBatch>[0]['action'],
  target = model,
  resolutionRequestId: string = randomUUID(),
) =>
  target.claimBatch({
    action,
    actorId: ownerId,
    batchId: rows[0].batchId,
    expectedItemCount: rows.length,
    expectedRequestRevisionHashes: Object.fromEntries(
      rows.map((row) => [row.id, row.requestRevisionHash]),
    ),
    expectedVersions: Object.fromEntries(rows.map((row) => [row.id, row.version])),
    operationId: rows[0].operationId,
    resolutionRequestId,
    scope: 'single',
    selectedInterventionIds: [rows[0].id],
  });

const answer = { answers: { mode: 'safe' }, type: 'submit_answers' } as const;

/** A claimed question decision; returns its still-`resolving` resolution. */
const createAnsweredResolution = async (overrides: Partial<CreateParams> = {}, target = model) => {
  const rows = await createBatch(overrides, target);
  const claimed = await claim(rows, answer, target);
  if (claimed.outcome !== 'applied') throw new Error('question claim failed');
  return { resolution: claimed.resolution, rows };
};

/** A claimed custom decision whose execution is still `pending`. */
const createCustomResolution = async () => {
  const rows = await createBatch({ items: [customItem()] });
  const claimed = await claim(rows, {
    expectedRevisionHash: rows[0].requestRevisionHash,
    result: { confirm: true },
    type: 'submit_custom',
  });
  if (claimed.outcome !== 'applied') throw new Error('custom claim failed');
  return { resolution: claimed.resolution, rows };
};

const claimLease = (resolutionRequestId: string, inputHash = 'c'.repeat(64)) =>
  model.claimCustomExecution({ inputHash, leaseDurationMs: 60_000, resolutionRequestId });

const parkOperation = (id: string) =>
  serverDB
    .update(agentOperations)
    .set({ status: 'waiting_for_human' })
    .where(eq(agentOperations.id, id));

const stubTransition = vi.fn(async (_tx: unknown, resolution: unknown, rows: unknown) => ({
  interventions: rows as AgentInterventionItem[],
  outcome: 'idempotent' as const,
  resolution: resolution as never,
}));

beforeEach(async () => {
  await serverDB.insert(users).values({ id: ownerId });
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'T874 intervention workspace',
    primaryOwnerId: ownerId,
    slug: 't874-ai-workspace',
  });
  await serverDB.insert(agentOperations).values([
    { id: operationId, status: 'running', userId: ownerId, workspaceId },
    { id: personalOperationId, status: 'running', userId: ownerId },
  ]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  stubTransition.mockClear();
  // agent_operations.user_id does not cascade; interventions and resolutions cascade from it.
  await serverDB
    .delete(agentOperations)
    .where(inArray(agentOperations.id, [operationId, personalOperationId]));
  await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await serverDB.delete(users).where(eq(users.id, ownerId));
});

describe('AgentInterventionModel coverage', () => {
  describe('personal scope', () => {
    it('creates and reads a batch with no workspace, invisible to the workspace scope', async () => {
      const [row] = await createBatch({ operationId: personalOperationId }, personalModel);

      expect(row.workspaceId).toBeNull();
      expect(await personalModel.findById(row.id)).toMatchObject({ id: row.id, status: 'pending' });
      expect(await model.findById(row.id)).toBeUndefined();
    });

    it('scopes resolutions to the personal owner', async () => {
      const { resolution } = await createAnsweredResolution(
        { operationId: personalOperationId },
        personalModel,
      );

      expect(
        await personalModel.findResolutionByRequestId(resolution.resolutionRequestId),
      ).toMatchObject({ id: resolution.id, workspaceId: null });
      expect(await model.findResolutionByRequestId(resolution.resolutionRequestId)).toBeUndefined();
    });

    it('expires an overdue personal row through the owner-only cold lookup', async () => {
      const [row] = await createBatch(
        { deadline: new Date(Date.now() - 1000), operationId: personalOperationId },
        personalModel,
      );

      expect(await personalModel.findByIdForOwner(row.id)).toMatchObject({
        id: row.id,
        status: 'timed_out',
      });
    });
  });

  describe('createBatch', () => {
    it('rejects an operation the caller does not own', async () => {
      await expect(createBatch({ operationId: 't874-ai-missing-operation' })).rejects.toThrow(
        AGENT_INTERVENTION_IDENTITY_CONFLICT,
      );
      await expect(
        createBatch({ operationId: personalOperationId }), // personal op, workspace caller
      ).rejects.toThrow(AGENT_INTERVENTION_IDENTITY_CONFLICT);
    });

    it('maps a review-token collision with another batch to an identity conflict', async () => {
      const [first] = await createBatch();

      const error = await createBatch({
        items: [questionItem({ reviewTokenHash: first.reviewTokenHash })],
      }).catch((caught: Error) => caught);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(AGENT_INTERVENTION_IDENTITY_CONFLICT);
      expect((error as Error).cause).toBeDefined();
    });

    it('rethrows an insert failure that is not a unique violation', async () => {
      const error = await createBatch({ deadline: new Date(Number.NaN) }).catch(
        (caught: Error) => caught,
      );

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toBe(AGENT_INTERVENTION_IDENTITY_CONFLICT);
      expect(
        await serverDB
          .select()
          .from(agentInterventions)
          .where(eq(agentInterventions.operationId, operationId)),
      ).toEqual([]);
    });

    it.each([
      ['an empty batch id', () => batchParams({ batchId: '' }), AGENT_INTERVENTION_INVALID_BATCH],
      [
        'a malformed review token hash',
        () => batchParams({ items: [questionItem({ reviewTokenHash: 'nope' })] }),
        AGENT_INTERVENTION_INVALID_REVIEW_TOKEN_HASH,
      ],
      [
        'a malformed request revision hash',
        () => batchParams({ items: [questionItem({ requestRevisionHash: 'nope' })] }),
        AGENT_INTERVENTION_INVALID_REQUEST_REVISION_HASH,
      ],
      [
        'a duplicated tool call id',
        () =>
          batchParams({
            items: [
              questionItem({ toolCallId: 't874-same-call' }),
              questionItem({ toolCallId: 't874-same-call' }),
            ],
          }),
        AGENT_INTERVENTION_INVALID_BATCH,
      ],
      [
        'approve-remember without a canonical tool key',
        () =>
          batchParams({
            items: [
              questionItem({
                allowedActions: ['approve', 'approve_remember'],
                interactionKind: 'tool_approval',
                sanitizedRequest: { apiName: 'writeFile', identifier: 'filesystem' },
                surface: 'binary',
              }),
            ],
          }),
        AGENT_INTERVENTION_INVALID_ACTION,
      ],
      [
        'a heterogeneous item with no provider',
        () => batchParams({ provider: undefined }),
        AGENT_INTERVENTION_INVALID_BATCH,
      ],
    ])('rejects %s before touching the database', async (_label, build, message) => {
      const transaction = vi.spyOn(serverDB, 'transaction');

      await expect(model.createBatch(build())).rejects.toThrow(message);
      expect(transaction).not.toHaveBeenCalled();
    });
  });

  describe('locators', () => {
    it('returns undefined for malformed or blank locator input', async () => {
      expect(
        await AgentInterventionModel.locateByReviewTokenHash(serverDB, 'nope'),
      ).toBeUndefined();
      expect(
        await AgentInterventionModel.locateByOperationAndToolCall(serverDB, ' ', 'call'),
      ).toBeUndefined();
      expect(
        await AgentInterventionModel.locateByResolutionRequestId(serverDB, 'not-a-uuid'),
      ).toBeUndefined();
    });
  });

  describe('lookups', () => {
    it('returns undefined for malformed or unknown ids and hashes', async () => {
      expect(await model.findByIdForOwner('not-a-uuid')).toBeUndefined();
      expect(await model.findByReviewTokenHash('nope')).toBeUndefined();
      expect(await model.findByReviewTokenHash('f'.repeat(64))).toBeUndefined();
      expect(await model.findResolutionByRequestId('not-a-uuid')).toBeUndefined();
    });

    it('finds an owned row by its review token hash', async () => {
      const [row] = await createBatch();

      expect(await model.findByReviewTokenHash(row.reviewTokenHash)).toMatchObject({
        id: row.id,
        status: 'pending',
      });
    });

    it('times out an overdue batch while reading it', async () => {
      const [row] = await createBatch({ deadline: new Date(Date.now() - 1000) });

      const state = await model.findBatch(operationId, row.batchId);

      expect(state.interventions).toEqual([
        expect.objectContaining({ id: row.id, status: 'timed_out' }),
      ]);
      expect(state.resolutions).toEqual([]);
    });

    it('falls back to the stale row when it vanished before the lazy timeout reload', async () => {
      const [row] = await createBatch({ deadline: new Date(Date.now() - 1000) });
      await serverDB.delete(agentInterventions).where(eq(agentInterventions.id, row.id));

      expect(await withLazyTimeout(workspaceCtx, row)).toBe(row);
      expect(await withOwnerLazyTimeout(workspaceCtx, row)).toBe(row);
    });
  });

  describe('markBatchTerminal', () => {
    it('returns an empty list for a batch that does not exist', async () => {
      expect(await model.markBatchTerminal(operationId, 't874-no-batch', 'session_ended')).toEqual(
        [],
      );
    });

    it('leaves a batch that is not yet due untouched on timeout', async () => {
      const [row] = await createBatch();

      const rows = await model.markBatchTerminal(operationId, row.batchId, 'timed_out');

      expect(rows).toEqual([
        expect.objectContaining({ id: row.id, status: 'pending', version: 1 }),
      ]);
    });

    it('is a no-op once every item is already terminal', async () => {
      const [row] = await createBatch();
      const [ended] = await model.markBatchTerminal(operationId, row.batchId, 'session_ended');

      const again = await model.markBatchTerminal(operationId, row.batchId, 'session_ended');

      expect(ended.status).toBe('session_ended');
      expect(again).toEqual([
        expect.objectContaining({ status: 'session_ended', version: ended.version }),
      ]);
    });

    it('keeps an item whose custom execution is in flight open', async () => {
      const { resolution, rows } = await createCustomResolution();
      expect((await claimLease(resolution.resolutionRequestId)).outcome).toBe('applied');

      const result = await model.markBatchTerminal(operationId, rows[0].batchId, 'session_ended');

      expect(result).toEqual([expect.objectContaining({ id: rows[0].id, status: 'resolving' })]);
      expect(await model.findResolutionByRequestId(resolution.resolutionRequestId)).toMatchObject({
        customExecutionState: 'executing',
        status: 'resolving',
      });
    });

    it('returns rows unchanged when none of them is open', async () => {
      const [row] = await createBatch();
      const [ended] = await model.markBatchTerminal(operationId, row.batchId, 'session_ended');

      const result = await serverDB.transaction((tx) =>
        markRowsTerminalInTransaction(workspaceCtx, tx, [ended], 'timed_out', new Date()),
      );

      expect(result).toEqual([ended]);
      expect(await model.findById(row.id)).toMatchObject({ status: 'session_ended' });
    });
  });

  describe('custom execution', () => {
    it('refuses a completed execution that stored a JSON null result', async () => {
      const { resolution } = await createCustomResolution();
      const lease = await claimLease(resolution.resolutionRequestId);
      expect(lease.outcome).toBe('applied');
      await serverDB
        .update(agentInterventionResolutions)
        .set({ customExecutionResult: sql`'null'::jsonb`, customExecutionState: 'completed' })
        .where(eq(agentInterventionResolutions.id, resolution.id));

      expect(await claimLease(resolution.resolutionRequestId)).toEqual({ outcome: 'conflict' });
    });

    it('claims a legacy submit-custom resolution that predates execution tracking', async () => {
      const { resolution } = await createCustomResolution();
      await serverDB
        .update(agentInterventionResolutions)
        .set({ customExecutionAttempt: null, customExecutionState: null })
        .where(eq(agentInterventionResolutions.id, resolution.id));

      const lease = await claimLease(resolution.resolutionRequestId);

      expect(lease).toMatchObject({ attempt: 1, outcome: 'applied' });
    });

    it('rejects a completion with a malformed request id', async () => {
      expect(
        await model.completeCustomExecution({
          inputHash: 'c'.repeat(64),
          leaseToken: randomUUID(),
          resolutionRequestId: 'not-a-uuid',
          result: { content: 'done', pluginState: {} },
        }),
      ).toEqual({ outcome: 'conflict' });
    });

    it('rejects a completion once the resolution has left resolving', async () => {
      const { resolution } = await createCustomResolution();
      const lease = await claimLease(resolution.resolutionRequestId);
      if (lease.outcome !== 'applied') throw new Error('lease claim failed');
      expect((await model.markResolutionPublished(resolution.resolutionRequestId)).outcome).toBe(
        'applied',
      );

      const completion = await model.completeCustomExecution({
        inputHash: 'c'.repeat(64),
        leaseToken: lease.leaseToken,
        resolutionRequestId: resolution.resolutionRequestId,
        result: { content: 'done', pluginState: {} },
      });

      expect(completion).toEqual({ outcome: 'conflict' });
      expect(await model.findResolutionByRequestId(resolution.resolutionRequestId)).toMatchObject({
        customExecutionResult: null,
        customExecutionState: 'executing',
        status: 'published',
      });
    });
  });

  describe('resolution transitions', () => {
    it('reports not_found for an unknown resolution request', async () => {
      expect(await model.markResolutionPublished(randomUUID())).toEqual({ outcome: 'not_found' });
    });

    it('refuses to publish a resolution its batch already ended', async () => {
      const { resolution, rows } = await createAnsweredResolution();
      await model.markBatchTerminal(operationId, rows[0].batchId, 'session_ended');

      const result = await model.markResolutionPublished(resolution.resolutionRequestId);

      expect(result).toMatchObject({
        outcome: 'conflict',
        resolution: { id: resolution.id, status: 'session_ended' },
      });
    });

    it('refuses a producer ACK for a runtime resolution', async () => {
      await parkOperation(operationId);
      const { resolution } = await createAnsweredResolution({
        provider: undefined,
        source: 'runtime',
      });

      await expect(model.recordProducerAck(resolution.resolutionRequestId)).rejects.toThrow(
        AGENT_INTERVENTION_SOURCE_TRANSITION_MISMATCH,
      );
    });

    it('conflicts on a producer ACK before the resolution ended', async () => {
      const { resolution } = await createAnsweredResolution();

      expect(await model.recordProducerAck(resolution.resolutionRequestId)).toMatchObject({
        outcome: 'conflict',
        resolution: { producerAckAt: null, status: 'resolving' },
      });
    });

    it('records a late producer ACK once and replays it idempotently', async () => {
      const { resolution, rows } = await createAnsweredResolution();
      await model.markBatchTerminal(operationId, rows[0].batchId, 'session_ended');
      const ackAt = new Date('2026-01-01T00:00:00.000Z');

      const first = await model.recordProducerAck(resolution.resolutionRequestId, ackAt);
      const second = await model.recordProducerAck(resolution.resolutionRequestId);

      expect(first.outcome).toBe('applied');
      expect(second).toMatchObject({
        outcome: 'idempotent',
        resolution: { producerAckAt: ackAt, status: 'session_ended' },
      });
    });

    it('locks the personal operation before running the transition', async () => {
      const { resolution } = await createAnsweredResolution(
        { operationId: personalOperationId },
        personalModel,
      );

      const result = await serverDB.transaction((tx) =>
        lockAndTransitionResolution(
          personalCtx,
          tx,
          resolution.resolutionRequestId,
          stubTransition,
          { lockOperation: true },
        ),
      );

      expect(result.outcome).toBe('idempotent');
      expect(stubTransition).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: resolution.id }),
        [expect.objectContaining({ resolutionId: resolution.id })],
      );
    });

    it('reports not_found when the operation disappears before it is locked', async () => {
      const { resolution } = await createAnsweredResolution();
      // Simulates a concurrent delete: the unlocked candidate read succeeds, the operation lock finds nothing.
      const tx = createProxyTestDB(serverDB, (query, result) =>
        query.includes('from "agent_operations"') && query.includes('for update')
          ? []
          : result.rows,
      );

      const result = await lockAndTransitionResolution(
        workspaceCtx,
        tx as never,
        resolution.resolutionRequestId,
        stubTransition,
        { lockOperation: true },
      );

      expect(result).toEqual({ outcome: 'not_found' });
      expect(stubTransition).not.toHaveBeenCalled();
    });

    it('reports not_found when the resolution disappears before it is locked', async () => {
      const { resolution } = await createAnsweredResolution();
      // Simulates a concurrent delete between the unlocked candidate read and the row lock.
      const tx = createProxyTestDB(serverDB, (query, result) =>
        query.includes('from "agent_intervention_resolutions"') && query.includes('for update')
          ? []
          : result.rows,
      );

      const result = await lockAndTransitionResolution(
        workspaceCtx,
        tx as never,
        resolution.resolutionRequestId,
        stubTransition,
      );

      expect(result).toEqual({ outcome: 'not_found' });
      expect(stubTransition).not.toHaveBeenCalled();
    });
  });
});
