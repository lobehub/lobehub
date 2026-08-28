// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import type { AgentInterventionItem } from '../../schemas';
import {
  agentInterventionResolutions,
  agentInterventions,
  agentOperations,
  messagePlugins,
  messages,
  users,
  userSettings,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  AGENT_INTERVENTION_IDENTITY_CONFLICT,
  AGENT_INTERVENTION_INVALID_ACTION,
  AGENT_INTERVENTION_INVALID_BATCH,
  AGENT_INTERVENTION_INVALID_REQUEST_REVISION_HASH,
  AGENT_INTERVENTION_RESOLUTION_REQUEST_REUSED,
  AGENT_INTERVENTION_SOURCE_TRANSITION_MISMATCH,
  AgentInterventionModel,
  hashAgentInterventionRequestRevision,
} from '../agentIntervention';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'agent-intervention-owner';
const actorId = 'agent-intervention-collaborator';
const otherUserId = 'agent-intervention-other';
const workspaceId = 'agent-intervention-workspace';
const operationId = 'agent-intervention-operation';
const secondOperationId = 'agent-intervention-operation-2';

const model = new AgentInterventionModel(serverDB, ownerId, workspaceId);
const coldOwnerModel = new AgentInterventionModel(serverDB, ownerId);
const otherUserModel = new AgentInterventionModel(serverDB, otherUserId, workspaceId);

let hashSequence = 0;
const nextHash = () => (++hashSequence).toString(16).padStart(64, 'a');

const questionItem = (overrides: Record<string, unknown> = {}) => ({
  allowedActions: ['submit_answers', 'skip_interaction', 'cancel_interaction'] as const,
  interactionKind: 'question' as const,
  provider: 'claude-code',
  requestRevisionHash: nextHash(),
  reviewContext: { summary: 'Choose a safe mode', title: 'Agent needs your input' },
  reviewTokenHash: nextHash(),
  sanitizedRequest: {
    apiName: 'askUserQuestion',
    identifier: 'claude-code',
    questions: [
      {
        id: 'mode',
        options: [
          { id: 'safe', label: 'Safe' },
          { id: 'fast', label: 'Fast' },
        ],
        question: 'Which mode?',
      },
    ],
  },
  surface: 'form' as const,
  toolCallId: `question-${hashSequence}`,
  ...overrides,
});

const createQuestionBatch = (overrides: Partial<Parameters<typeof model.createBatch>[0]> = {}) =>
  model.createBatch({
    activityKey: `activity-${hashSequence + 1}`,
    batchId: `batch-${hashSequence + 1}`,
    deadline: new Date(Date.now() + 10 * 60_000),
    items: [questionItem()],
    operationId,
    provider: 'claude-code',
    source: 'heterogeneous',
    stepIndex: 0,
    systemActionEligibility: 'review_only',
    ...overrides,
  });

const snapshot = (rows: AgentInterventionItem[]) => ({
  expectedItemCount: rows.length,
  expectedRequestRevisionHashes: Object.fromEntries(
    rows.map((row) => [row.id, row.requestRevisionHash]),
  ),
  expectedVersions: Object.fromEntries(rows.map((row) => [row.id, row.version])),
});

const createReparkBatchParams = (
  rows: AgentInterventionItem[],
  overrides: Partial<Parameters<typeof model.createBatch>[0]> = {},
): Parameters<typeof model.createBatch>[0] => ({
  activityKey: `repark-activity-${hashSequence + 1}`,
  approvalMode: rows[0].approvalMode ?? undefined,
  batchId: `repark-batch-${hashSequence + 1}`,
  deadline: new Date(Date.now() + 10 * 60_000),
  items: rows.map((row) => ({
    allowedActions: row.allowedActions,
    canonicalToolKey: row.canonicalToolKey ?? undefined,
    interactionKind: row.interactionKind,
    provider: row.provider ?? undefined,
    requestRevisionHash: row.requestRevisionHash,
    reviewContext: row.reviewContext,
    reviewTokenHash: nextHash(),
    risk: row.risk ?? undefined,
    sanitizedRequest: row.sanitizedRequest,
    surface: row.surface,
    toolCallId: row.toolCallId,
    toolMessageId: row.toolMessageId ?? undefined,
  })),
  operationId: secondOperationId,
  provider: rows[0].provider ?? undefined,
  source: 'runtime',
  stepIndex: rows[0].stepIndex + 1,
  systemActionEligibility: 'review_only',
  ...overrides,
});

const claim = (
  rows: AgentInterventionItem[],
  action: Parameters<typeof model.claimBatch>[0]['action'],
  overrides: Partial<Parameters<typeof model.claimBatch>[0]> = {},
) =>
  model.claimBatch({
    action,
    actorId,
    batchId: rows[0].batchId,
    operationId: rows[0].operationId,
    resolutionRequestId: randomUUID(),
    scope: 'single',
    selectedInterventionIds: [rows[0].id],
    ...snapshot(rows),
    ...overrides,
  });

const createCustomResolution = async (resolutionRequestId = randomUUID()) => {
  const [row] = await createQuestionBatch({
    batchId: `custom-execution-${hashSequence + 1}`,
    items: [
      questionItem({
        allowedActions: ['submit_custom'],
        interactionKind: 'custom',
        sanitizedRequest: {
          apiName: 'installMarketplaceItem',
          fields: [{ id: 'confirm', label: 'Install', required: true, type: 'boolean' }],
        },
        toolCallId: `custom-execution-tool-${hashSequence + 1}`,
      }),
    ],
  });
  const claimed = await claim(
    [row],
    {
      expectedRevisionHash: row.requestRevisionHash,
      result: { confirm: true },
      type: 'submit_custom',
    },
    { resolutionRequestId },
  );
  if (claimed.outcome !== 'applied') throw new Error('custom resolution claim failed');
  return { resolution: claimed.resolution, row };
};

const createMixedCustomResolution = async (resolutionRequestId = randomUUID()) => {
  const rows = await model.createBatch({
    activityKey: `mixed-custom-execution-activity-${hashSequence + 1}`,
    batchId: `mixed-custom-execution-${hashSequence + 1}`,
    deadline: new Date(Date.now() + 10 * 60_000),
    items: [
      questionItem({
        allowedActions: ['submit_custom'],
        interactionKind: 'custom',
        sanitizedRequest: {
          apiName: 'installMarketplaceItem',
          fields: [{ id: 'confirm', label: 'Install', required: true, type: 'boolean' }],
        },
        toolCallId: `mixed-custom-execution-tool-${hashSequence + 1}`,
      }),
      questionItem({ toolCallId: `mixed-custom-sibling-${hashSequence + 1}` }),
    ],
    operationId,
    provider: 'claude-code',
    source: 'heterogeneous',
    stepIndex: 0,
    systemActionEligibility: 'review_only',
  });
  const claimed = await claim(
    rows,
    {
      expectedRevisionHash: rows[0].requestRevisionHash,
      result: { confirm: true },
      type: 'submit_custom',
    },
    { resolutionRequestId, selectedInterventionIds: [rows[0].id] },
  );
  if (claimed.outcome !== 'applied') throw new Error('mixed custom resolution claim failed');
  return { resolution: claimed.resolution, rows };
};

const seedToolMessage = async (params: {
  argumentsText: string;
  toolCallId: string;
  toolMessageId: string;
}) => {
  const assistantId = `assistant-${params.toolMessageId}`;
  await serverDB.insert(messages).values({
    content: '',
    id: assistantId,
    role: 'assistant',
    tools: [
      {
        apiName: 'writeFile',
        arguments: params.argumentsText,
        id: params.toolCallId,
        identifier: 'filesystem',
        type: 'builtin',
      },
    ],
    userId: ownerId,
    workspaceId,
  });
  await serverDB.insert(messages).values({
    content: '',
    id: params.toolMessageId,
    parentId: assistantId,
    role: 'tool',
    userId: ownerId,
    workspaceId,
  });
  await serverDB.insert(messagePlugins).values({
    apiName: 'writeFile',
    arguments: params.argumentsText,
    id: params.toolMessageId,
    identifier: 'filesystem',
    toolCallId: params.toolCallId,
    userId: ownerId,
    workspaceId,
  });
  return assistantId;
};

const parkOperation = (id = operationId) =>
  serverDB
    .update(agentOperations)
    .set({ completedAt: null, completionReason: 'waiting_for_human', status: 'waiting_for_human' })
    .where(eq(agentOperations.id, id));

const createRuntimeApprovalBatch = async (params?: {
  batchId?: string;
  canonicalToolKey?: string;
  count?: number;
  operationId?: string;
  systemActionEligibility?: 'review_only' | 'safe_single_binary';
}) => {
  const count = params?.count ?? 1;
  const op = params?.operationId ?? operationId;
  await parkOperation(op);
  const items = [];
  for (let index = 0; index < count; index++) {
    const toolCallId = `${op}-tool-${hashSequence + index + 1}`;
    const toolMessageId = `${op}-tool-message-${hashSequence + index + 1}`;
    const argumentsText = JSON.stringify({ path: `file-${index}.txt` });
    await seedToolMessage({ argumentsText, toolCallId, toolMessageId });
    items.push({
      allowedActions: [
        'approve',
        'approve_remember',
        'edit_arguments',
        'reject_continue',
        'stop',
      ] as const,
      canonicalToolKey: params?.canonicalToolKey ?? 'filesystem/writeFile',
      interactionKind: 'tool_approval' as const,
      requestRevisionHash: hashAgentInterventionRequestRevision(argumentsText),
      reviewContext: { title: `Write file ${index + 1}` },
      reviewTokenHash: nextHash(),
      risk: { level: 'low' as const },
      sanitizedRequest: {
        apiName: 'writeFile',
        argumentCount: 1,
        identifier: 'filesystem',
        parameterNames: ['path'],
      },
      surface: 'binary' as const,
      toolCallId,
      toolMessageId,
    });
  }
  return model.createBatch({
    activityKey: `runtime-activity-${hashSequence + 1}`,
    approvalMode: 'allow-list',
    batchId: params?.batchId ?? `runtime-batch-${hashSequence + 1}`,
    deadline: new Date(Date.now() + 10 * 60_000),
    items,
    operationId: op,
    source: 'runtime',
    stepIndex: 3,
    systemActionEligibility:
      params?.systemActionEligibility ?? (count === 1 ? 'safe_single_binary' : 'review_only'),
  });
};

beforeEach(async () => {
  hashSequence = 0;
  await serverDB.delete(agentInterventions);
  await serverDB.delete(agentInterventionResolutions);
  await serverDB.delete(messagePlugins);
  await serverDB.delete(messages);
  await serverDB.delete(agentOperations);
  await serverDB.delete(userSettings);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: ownerId }, { id: actorId }, { id: otherUserId }]);
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'Intervention workspace',
    primaryOwnerId: ownerId,
    slug: 'agent-intervention-workspace',
  });
  await serverDB.insert(agentOperations).values([
    { id: operationId, status: 'running', userId: ownerId, workspaceId },
    { id: secondOperationId, status: 'running', userId: ownerId, workspaceId },
  ]);
});

describe('AgentInterventionModel', () => {
  it('hashes the exact raw arguments string for request revision compatibility', () => {
    expect(hashAgentInterventionRequestRevision('{"path":"/tmp/a"}')).toBe(
      '15df809ad5fadb66f0b31bafc206dcfe620d8da8767fb76e41d3603a45dc870d',
    );
  });

  it('persists a hash-only sanitized request and exposes a minimal system locator', async () => {
    const [row] = await createQuestionBatch({ batchId: 'cold-batch' });

    expect(row).toMatchObject({
      batchId: 'cold-batch',
      itemCount: 1,
      itemIndex: 0,
      provider: 'claude-code',
      sealed: true,
      source: 'heterogeneous',
      status: 'pending',
      systemActionEligibility: 'review_only',
    });
    expect(row.sanitizedRequest).not.toHaveProperty('arguments');
    expect(await coldOwnerModel.findByIdForOwner(row.id)).toMatchObject({ workspaceId });
    expect(await otherUserModel.findByReviewTokenHash(row.reviewTokenHash)).toBeUndefined();

    const locator = await AgentInterventionModel.locateByReviewTokenHash(
      serverDB,
      row.reviewTokenHash,
    );
    expect(locator).toEqual({
      activityKey: row.activityKey,
      batchId: 'cold-batch',
      deadline: row.deadline,
      id: row.id,
      operationId,
      source: 'heterogeneous',
      status: 'pending',
      userId: ownerId,
      workspaceId,
    });
    expect(locator).not.toHaveProperty('reviewTokenHash');
    expect(locator).not.toHaveProperty('reviewContext');

    expect(
      await AgentInterventionModel.locateByOperationAndToolCall(
        serverDB,
        row.operationId,
        row.toolCallId,
      ),
    ).toEqual(locator);
    expect(
      await AgentInterventionModel.locateByOperationAndToolCall(
        serverDB,
        row.operationId,
        'unknown-tool-call',
      ),
    ).toBeUndefined();
  });

  it('expires a workspace batch after an owner-only cold lookup restores its scope', async () => {
    const [row] = await createQuestionBatch({ batchId: 'cold-timeout-batch' });
    await serverDB
      .update(agentInterventions)
      .set({ deadline: new Date(Date.now() - 1000) })
      .where(eq(agentInterventions.id, row.id));

    expect(await coldOwnerModel.findByIdForOwner(row.id)).toMatchObject({
      status: 'timed_out',
      workspaceId,
    });
  });

  it('requires complete identity equality for idempotent create', async () => {
    const params: Parameters<typeof model.createBatch>[0] = {
      activityKey: 'identity-activity',
      batchId: 'identity-batch',
      deadline: new Date(Date.now() + 60_000),
      items: [questionItem({ toolCallId: 'identity-tool' })],
      operationId,
      provider: 'claude-code',
      source: 'heterogeneous',
      stepIndex: 0,
      systemActionEligibility: 'review_only',
    };
    const first = await model.createBatch(params);
    expect(await model.createBatch(params)).toEqual(first);

    await expect(
      model.createBatch({
        ...params,
        items: [{ ...params.items[0], allowedActions: ['cancel_interaction'] }],
      }),
    ).rejects.toThrow(AGENT_INTERVENTION_IDENTITY_CONFLICT);
  });

  it('normalizes optional undefined fields from durable Review DTOs before persistence', async () => {
    const item = questionItem({
      canonicalToolKey: undefined,
      provider: undefined,
      reviewContext: {
        agentLabel: undefined,
        resourceLabel: undefined,
        summary: undefined,
        title: 'Optional Review fields',
      },
      risk: { level: 'low', summary: undefined, warnings: undefined },
      sanitizedRequest: {
        apiName: 'askUserQuestion',
        identifier: undefined,
        questions: [
          {
            header: undefined,
            id: 'mode',
            options: [
              {
                description: undefined,
                id: 'safe',
                label: 'Safe',
                recommended: undefined,
              },
            ],
            question: 'Which mode?',
          },
        ],
      },
      toolCallId: 'optional-review-tool',
      toolMessageId: undefined,
    });
    const params: Parameters<typeof model.createBatch>[0] = {
      activityKey: 'optional-review-activity',
      batchId: 'optional-review-batch',
      deadline: new Date(Date.now() + 60_000),
      items: [item],
      operationId,
      provider: 'claude-code',
      source: 'heterogeneous',
      stepIndex: 0,
      systemActionEligibility: 'review_only',
    };

    const created = await model.createBatch(params);

    expect(created[0]).toMatchObject({
      canonicalToolKey: null,
      provider: 'claude-code',
      reviewContext: { title: 'Optional Review fields' },
      risk: { level: 'low' },
      sanitizedRequest: {
        apiName: 'askUserQuestion',
        questions: [
          {
            id: 'mode',
            options: [{ id: 'safe', label: 'Safe' }],
            question: 'Which mode?',
          },
        ],
      },
      toolMessageId: null,
    });
    expect(await model.createBatch(params)).toEqual(created);
  });

  it('rejects non-JSON-safe values from durable Review metadata', async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const sparseArray: unknown[] = [];
    sparseArray.length = 1;
    const unsafeValues: [string, unknown][] = [
      ['date', new Date()],
      ['bigint', 1n],
      ['function', () => true],
      ['symbol', Symbol('unsafe')],
      ['nan', Number.NaN],
      ['infinity', Number.POSITIVE_INFINITY],
      ['negative-infinity', Number.NEGATIVE_INFINITY],
      ['array-undefined', [undefined]],
      ['sparse-array', sparseArray],
      ['cycle', cyclic],
    ];

    for (const [name, value] of unsafeValues) {
      await expect(
        createQuestionBatch({
          batchId: `unsafe-review-${name}`,
          items: [
            questionItem({
              reviewContext: { title: 'Unsafe Review', value } as never,
              toolCallId: `unsafe-review-tool-${name}`,
            }),
          ],
        }),
      ).rejects.toThrow(AGENT_INTERVENTION_INVALID_BATCH);
    }
  });

  it('reports applied then idempotent when the atomic create has no predecessor', async () => {
    const params: Parameters<typeof model.createBatch>[0] = {
      activityKey: 'atomic-create-activity',
      batchId: 'atomic-create-batch',
      deadline: new Date(Date.now() + 60_000),
      items: [questionItem({ toolCallId: 'atomic-create-tool' })],
      operationId,
      provider: 'claude-code',
      source: 'heterogeneous',
      stepIndex: 0,
      systemActionEligibility: 'review_only',
    };

    expect(await model.createBatchWithSupersession({ batch: params })).toMatchObject({
      outcome: 'applied',
    });
    expect(await model.createBatchWithSupersession({ batch: params })).toMatchObject({
      outcome: 'idempotent',
    });
  });

  it('creates a new runtime batch only while its locked operation is waiting for human', async () => {
    const params: Parameters<typeof model.createBatch>[0] = {
      activityKey: 'runtime-state-activity',
      batchId: 'runtime-state-batch',
      deadline: new Date(Date.now() + 60_000),
      items: [questionItem({ toolCallId: 'runtime-state-tool' })],
      operationId,
      source: 'runtime',
      stepIndex: 0,
      systemActionEligibility: 'review_only',
    };
    await serverDB
      .update(agentOperations)
      .set({ status: 'done' })
      .where(eq(agentOperations.id, operationId));

    await expect(model.createBatch(params)).rejects.toThrow(AGENT_INTERVENTION_IDENTITY_CONFLICT);
    expect((await model.findBatch(operationId, params.batchId)).interventions).toEqual([]);

    await parkOperation();
    const created = await model.createBatch(params);
    await serverDB
      .update(agentOperations)
      .set({ status: 'done' })
      .where(eq(agentOperations.id, operationId));
    expect(await model.createBatch(params)).toEqual(created);
  });

  it('closes the terminal-operation race for atomic runtime create without a predecessor', async () => {
    const params: Parameters<typeof model.createBatch>[0] = {
      activityKey: 'atomic-runtime-state-activity',
      batchId: 'atomic-runtime-state-batch',
      deadline: new Date(Date.now() + 60_000),
      items: [questionItem({ toolCallId: 'atomic-runtime-state-tool' })],
      operationId,
      source: 'runtime',
      stepIndex: 0,
      systemActionEligibility: 'review_only',
    };
    await serverDB
      .update(agentOperations)
      .set({ status: 'done' })
      .where(eq(agentOperations.id, operationId));

    await expect(model.createBatchWithSupersession({ batch: params })).rejects.toThrow(
      AGENT_INTERVENTION_IDENTITY_CONFLICT,
    );
    expect((await model.findBatch(operationId, params.batchId)).interventions).toEqual([]);

    await parkOperation();
    expect(await model.createBatchWithSupersession({ batch: params })).toMatchObject({
      outcome: 'applied',
    });
    await serverDB
      .update(agentOperations)
      .set({ status: 'done' })
      .where(eq(agentOperations.id, operationId));
    expect(await model.createBatchWithSupersession({ batch: params })).toMatchObject({
      outcome: 'idempotent',
    });
  });

  it('allows heterogeneous batches regardless of the owner operation status', async () => {
    await serverDB
      .update(agentOperations)
      .set({ status: 'done' })
      .where(eq(agentOperations.id, operationId));

    expect(await createQuestionBatch({ batchId: 'terminal-heterogeneous-batch' })).toHaveLength(1);
  });

  it('keeps identical batch ids isolated by operation id', async () => {
    const first = await createQuestionBatch({ batchId: 'shared-batch', operationId });
    const second = await createQuestionBatch({
      batchId: 'shared-batch',
      operationId: secondOperationId,
    });

    const firstState = await model.findBatch(operationId, 'shared-batch');
    const secondState = await model.findBatch(secondOperationId, 'shared-batch');
    expect(firstState.interventions.map((row) => row.id)).toEqual([first[0].id]);
    expect(secondState.interventions.map((row) => row.id)).toEqual([second[0].id]);

    const result = await claim(first, { answers: { mode: 'safe' }, type: 'submit_answers' });
    expect(result.outcome).toBe('applied');
    expect((await model.findBatch(secondOperationId, 'shared-batch')).interventions[0].status).toBe(
      'pending',
    );
  });

  it('claims all binary items in one sealed transaction and records action outcome', async () => {
    const rows = await createRuntimeApprovalBatch({ count: 2 });
    const result = await claim(
      rows,
      { type: 'approve' },
      {
        actorId: ownerId,
        scope: 'all',
        selectedInterventionIds: rows.map((row) => row.id),
      },
    );
    expect(result.outcome).toBe('applied');
    if (result.outcome !== 'applied') throw new Error('claim failed');
    expect(result.interventions.every((row) => row.status === 'resolving')).toBe(true);
    expect(result.resolution).toMatchObject({
      action: { type: 'approve' },
      scope: 'all',
      selectedInterventionIds: rows.map((row) => row.id).sort(),
    });

    await model.markResolutionPublished(result.resolution.resolutionRequestId);
    await model.completeRuntimeResolution(result.resolution.resolutionRequestId);
    const state = await model.findBatch(rows[0].operationId, rows[0].batchId);
    expect(state.interventions.every((row) => row.status === 'resolved')).toBe(true);
    expect(state.resolutions[0]).toMatchObject({
      action: { type: 'approve' },
      status: 'completed',
    });
  });

  it('allows a partial custom item without claiming the rest of a mixed batch', async () => {
    await parkOperation();
    const rows = await model.createBatch({
      activityKey: 'custom-activity',
      batchId: 'custom-batch',
      deadline: new Date(Date.now() + 60_000),
      items: [
        questionItem({
          allowedActions: ['submit_custom'],
          interactionKind: 'custom',
          sanitizedRequest: {
            apiName: 'installMarketplaceItem',
            fields: [{ id: 'confirm', label: 'Install', required: true, type: 'boolean' }],
          },
          toolCallId: 'custom-1',
        }),
        questionItem({ toolCallId: 'question-2' }),
      ],
      operationId,
      source: 'runtime',
      stepIndex: 1,
      systemActionEligibility: 'review_only',
    });
    const result = await claim(
      rows,
      {
        expectedRevisionHash: rows[0].requestRevisionHash,
        result: { confirm: true },
        type: 'submit_custom',
      },
      { selectedInterventionIds: [rows[0].id] },
    );
    expect(result.outcome).toBe('applied');
    const state = await model.findBatch(operationId, 'custom-batch');
    expect(state.interventions.map((row) => row.status)).toEqual(['resolving', 'pending']);
  });

  describe('custom execution ledger', () => {
    const inputHash = 'b'.repeat(64);
    const otherInputHash = 'c'.repeat(64);
    const leaseDurationMs = 60_000;

    it('initializes only custom resolutions as private pending executions', async () => {
      const { resolution } = await createCustomResolution();
      expect(await model.findResolutionByRequestId(resolution.resolutionRequestId)).toMatchObject({
        customExecutionAttempt: 0,
        customExecutionInputHash: null,
        customExecutionLeaseExpiresAt: null,
        customExecutionLeaseToken: null,
        customExecutionResult: null,
        customExecutionState: 'pending',
      });

      const rows = await createQuestionBatch({ batchId: 'non-custom-execution' });
      const ordinary = await claim(rows, { answers: { mode: 'safe' }, type: 'submit_answers' });
      if (ordinary.outcome !== 'applied') throw new Error('ordinary resolution claim failed');
      expect(
        await model.findResolutionByRequestId(ordinary.resolution.resolutionRequestId),
      ).toMatchObject({
        customExecutionAttempt: null,
        customExecutionInputHash: null,
        customExecutionLeaseExpiresAt: null,
        customExecutionLeaseToken: null,
        customExecutionResult: null,
        customExecutionState: null,
      });
    });

    it('atomically grants one lease for concurrent claims of the same resolution', async () => {
      const { resolution } = await createCustomResolution();
      const now = new Date('2026-08-26T10:00:00.000Z');
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          model.claimCustomExecution(
            {
              inputHash,
              leaseDurationMs,
              resolutionRequestId: resolution.resolutionRequestId,
            },
            now,
          ),
        ),
      );

      expect(results.filter(({ outcome }) => outcome === 'applied')).toHaveLength(1);
      expect(results.filter(({ outcome }) => outcome === 'in_progress')).toHaveLength(7);
      const applied = results.find(({ outcome }) => outcome === 'applied');
      expect(applied).toMatchObject({ attempt: 1, outcome: 'applied' });
    });

    it('returns in_progress without exposing the live lease token', async () => {
      const { resolution } = await createCustomResolution();
      const now = new Date('2026-08-26T10:00:00.000Z');
      const params = {
        inputHash,
        leaseDurationMs,
        resolutionRequestId: resolution.resolutionRequestId,
      };
      expect(await model.claimCustomExecution(params, now)).toMatchObject({
        attempt: 1,
        outcome: 'applied',
      });

      const live = await model.claimCustomExecution(params, new Date(now.getTime() + 59_999));
      expect(live).toMatchObject({ attempt: 1, outcome: 'in_progress' });
      expect(live).not.toHaveProperty('leaseToken');
    });

    it('does not claim a pending execution after its resolution rolls back', async () => {
      const { resolution } = await createCustomResolution();
      expect((await model.rollbackResolution(resolution.resolutionRequestId)).outcome).toBe(
        'applied',
      );

      expect(
        await model.claimCustomExecution({
          inputHash,
          leaseDurationMs,
          resolutionRequestId: resolution.resolutionRequestId,
        }),
      ).toEqual({ outcome: 'conflict' });
      expect(await model.findResolutionByRequestId(resolution.resolutionRequestId)).toMatchObject({
        customExecutionAttempt: 0,
        customExecutionState: 'pending',
        status: 'rolled_back',
      });
    });

    it('allows terminal transition before execution and rejects the later claim', async () => {
      const { resolution, row } = await createCustomResolution();
      const terminalRows = await model.markBatchTerminal(
        row.operationId,
        row.batchId,
        'session_ended',
      );
      expect(terminalRows[0].status).toBe('session_ended');
      expect(
        await model.claimCustomExecution({
          inputHash,
          leaseDurationMs,
          resolutionRequestId: resolution.resolutionRequestId,
        }),
      ).toEqual({ outcome: 'conflict' });
      expect(await model.findResolutionByRequestId(resolution.resolutionRequestId)).toMatchObject({
        customExecutionState: 'pending',
        status: 'session_ended',
      });
    });

    it('protects an executing winner while terminalizing its pending sibling', async () => {
      const { resolution, rows } = await createMixedCustomResolution();
      const now = new Date('2026-08-26T10:00:00.000Z');
      const params = {
        inputHash,
        leaseDurationMs: 1000,
        resolutionRequestId: resolution.resolutionRequestId,
      };
      const claimed = await model.claimCustomExecution(params, now);
      if (claimed.outcome !== 'applied') throw new Error('execution lease claim failed');

      await model.markBatchTerminal(
        rows[0].operationId,
        rows[0].batchId,
        'session_ended',
        new Date(now.getTime() + 2000),
      );
      const state = await model.findBatch(rows[0].operationId, rows[0].batchId);
      expect(state.interventions.map(({ status }) => status)).toEqual([
        'resolving',
        'session_ended',
      ]);
      expect(await model.findResolutionByRequestId(resolution.resolutionRequestId)).toMatchObject({
        customExecutionAttempt: 1,
        customExecutionLeaseToken: claimed.leaseToken,
        customExecutionState: 'executing',
        status: 'resolving',
      });
      expect(
        await model.claimCustomExecution(params, new Date(now.getTime() + 2000)),
      ).toMatchObject({ attempt: 2, outcome: 'applied' });
    });

    it('replays the exact completed result and conflicts on input or result drift', async () => {
      const { resolution, row } = await createCustomResolution();
      const claimed = await model.claimCustomExecution({
        inputHash,
        leaseDurationMs,
        resolutionRequestId: resolution.resolutionRequestId,
      });
      if (claimed.outcome !== 'applied') throw new Error('execution lease claim failed');

      const result = {
        content: 'Installed two agents',
        pluginState: { agentIds: ['agent-a', 'agent-b'], source: 'marketplace' },
      };
      expect(
        await model.completeCustomExecution({
          inputHash,
          leaseToken: claimed.leaseToken,
          resolutionRequestId: resolution.resolutionRequestId,
          result,
        }),
      ).toEqual({ outcome: 'completed', result });
      expect(
        await model.completeCustomExecution({
          inputHash,
          leaseToken: claimed.leaseToken,
          resolutionRequestId: resolution.resolutionRequestId,
          result: {
            content: 'Installed two agents',
            pluginState: { source: 'marketplace', agentIds: ['agent-a', 'agent-b'] },
          },
        }),
      ).toEqual({ outcome: 'completed', result });
      expect(
        await model.completeCustomExecution({
          inputHash,
          leaseToken: claimed.leaseToken,
          resolutionRequestId: resolution.resolutionRequestId,
          result: { ...result, content: 'Different result' },
        }),
      ).toEqual({ outcome: 'conflict' });
      expect(
        await model.claimCustomExecution({
          inputHash,
          leaseDurationMs,
          resolutionRequestId: resolution.resolutionRequestId,
        }),
      ).toEqual({ outcome: 'completed', result });
      expect(
        await model.claimCustomExecution({
          inputHash: otherInputHash,
          leaseDurationMs,
          resolutionRequestId: resolution.resolutionRequestId,
        }),
      ).toEqual({ outcome: 'conflict' });

      const publicState = await model.findBatch(row.operationId, row.batchId);
      expect(publicState.resolutions[0]).not.toHaveProperty('customExecutionAttempt');
      expect(publicState.resolutions[0]).not.toHaveProperty('customExecutionInputHash');
      expect(publicState.resolutions[0]).not.toHaveProperty('customExecutionLeaseExpiresAt');
      expect(publicState.resolutions[0]).not.toHaveProperty('customExecutionLeaseToken');
      expect(publicState.resolutions[0]).not.toHaveProperty('customExecutionResult');
      expect(publicState.resolutions[0]).not.toHaveProperty('customExecutionState');
    });

    it('takes over an expired lease and fences the stale completion', async () => {
      const { resolution } = await createCustomResolution();
      const now = new Date('2026-08-26T10:00:00.000Z');
      const params = {
        inputHash,
        leaseDurationMs: 1000,
        resolutionRequestId: resolution.resolutionRequestId,
      };
      const first = await model.claimCustomExecution(params, now);
      if (first.outcome !== 'applied') throw new Error('first execution lease claim failed');
      const second = await model.claimCustomExecution(params, new Date(now.getTime() + 1000));
      if (second.outcome !== 'applied') throw new Error('lease takeover failed');

      expect(second).toMatchObject({ attempt: 2, outcome: 'applied' });
      expect(second.leaseToken).not.toBe(first.leaseToken);
      const result = { content: 'Installed', pluginState: { agentId: 'agent-a' } };
      expect(
        await model.completeCustomExecution({
          inputHash,
          leaseToken: first.leaseToken,
          resolutionRequestId: resolution.resolutionRequestId,
          result,
        }),
      ).toEqual({ outcome: 'conflict' });
      expect(
        await model.completeCustomExecution({
          inputHash,
          leaseToken: second.leaseToken,
          resolutionRequestId: resolution.resolutionRequestId,
          result,
        }),
      ).toEqual({ outcome: 'completed', result });
    });

    it('protects a completed winner from terminal teardown and replays its result', async () => {
      const { resolution, rows } = await createMixedCustomResolution();
      const params = {
        inputHash,
        leaseDurationMs,
        resolutionRequestId: resolution.resolutionRequestId,
      };
      const claimed = await model.claimCustomExecution(params);
      if (claimed.outcome !== 'applied') throw new Error('execution lease claim failed');
      const result = { content: 'Installed', pluginState: { agentId: 'agent-a' } };
      expect(
        await model.completeCustomExecution({
          inputHash,
          leaseToken: claimed.leaseToken,
          resolutionRequestId: resolution.resolutionRequestId,
          result,
        }),
      ).toEqual({ outcome: 'completed', result });

      await model.markBatchTerminal(
        rows[0].operationId,
        rows[0].batchId,
        'timed_out',
        new Date(Math.max(...rows.map(({ deadline }) => deadline.getTime())) + 1),
      );
      const state = await model.findBatch(rows[0].operationId, rows[0].batchId);
      expect(state.interventions.map(({ status }) => status)).toEqual(['resolving', 'timed_out']);
      expect(state.resolutions[0]).toMatchObject({ status: 'resolving' });
      expect(await model.claimCustomExecution(params)).toEqual({ outcome: 'completed', result });
    });

    it('keeps a heterogeneous completed result replayable after producer ACK', async () => {
      const { resolution } = await createCustomResolution();
      const params = {
        inputHash,
        leaseDurationMs,
        resolutionRequestId: resolution.resolutionRequestId,
      };
      const claimed = await model.claimCustomExecution(params);
      if (claimed.outcome !== 'applied') throw new Error('execution lease claim failed');
      const result = { content: 'Installed', pluginState: { agentId: 'agent-a' } };
      expect(
        await model.completeCustomExecution({
          inputHash,
          leaseToken: claimed.leaseToken,
          resolutionRequestId: resolution.resolutionRequestId,
          result,
        }),
      ).toEqual({ outcome: 'completed', result });

      expect((await model.markResolutionPublished(resolution.resolutionRequestId)).outcome).toBe(
        'applied',
      );
      expect(
        (await model.acknowledgeProducerResolution(resolution.resolutionRequestId)).outcome,
      ).toBe('applied');
      expect(await model.claimCustomExecution(params)).toEqual({ outcome: 'completed', result });
      expect(await model.findResolutionByRequestId(resolution.resolutionRequestId)).toMatchObject({
        customExecutionState: 'completed',
        status: 'acknowledged',
      });
    });

    it('keeps the original execution active when its claim wins before rollback', async () => {
      const { resolution } = await createCustomResolution();
      const params = {
        inputHash,
        leaseDurationMs: 1000,
        resolutionRequestId: resolution.resolutionRequestId,
      };
      const now = new Date('2026-08-26T10:00:00.000Z');
      const claimed = await model.claimCustomExecution(params, now);
      if (claimed.outcome !== 'applied') throw new Error('execution lease claim failed');
      const result = { content: 'Installed', pluginState: { agentId: 'agent-a' } };

      expect((await model.rollbackResolution(resolution.resolutionRequestId)).outcome).toBe(
        'conflict',
      );
      expect(
        await model.claimCustomExecution(params, new Date(now.getTime() + 1000)),
      ).toMatchObject({ attempt: 2, outcome: 'applied' });
      expect(
        await model.completeCustomExecution({
          inputHash,
          leaseToken: claimed.leaseToken,
          resolutionRequestId: resolution.resolutionRequestId,
          result,
        }),
      ).toEqual({ outcome: 'conflict' });
    });

    it('replays the durable result when completion wins before rollback', async () => {
      const { resolution, row } = await createCustomResolution();
      const params = {
        inputHash,
        leaseDurationMs,
        resolutionRequestId: resolution.resolutionRequestId,
      };
      const claimed = await model.claimCustomExecution(params);
      if (claimed.outcome !== 'applied') throw new Error('execution lease claim failed');
      const result = { content: 'Installed', pluginState: { agentId: 'agent-a' } };
      const completion = {
        inputHash,
        leaseToken: claimed.leaseToken,
        resolutionRequestId: resolution.resolutionRequestId,
        result,
      };

      expect(await model.completeCustomExecution(completion)).toEqual({
        outcome: 'completed',
        result,
      });
      expect((await model.rollbackResolution(resolution.resolutionRequestId)).outcome).toBe(
        'conflict',
      );
      expect(await model.completeCustomExecution(completion)).toEqual({
        outcome: 'completed',
        result,
      });
      expect(await model.claimCustomExecution(params)).toEqual({ outcome: 'completed', result });

      const currentRows = (await model.findBatch(row.operationId, row.batchId)).interventions;
      expect(
        await claim(
          currentRows,
          {
            expectedRevisionHash: currentRows[0].requestRevisionHash,
            result: { confirm: true },
            type: 'submit_custom',
          },
          { resolutionRequestId: randomUUID() },
        ),
      ).toMatchObject({ outcome: 'conflict' });
    });

    it('rejects terminal writes from old instances once custom execution has started', async () => {
      const { resolution } = await createCustomResolution();
      const claimed = await model.claimCustomExecution({
        inputHash,
        leaseDurationMs,
        resolutionRequestId: resolution.resolutionRequestId,
      });
      if (claimed.outcome !== 'applied') throw new Error('execution lease claim failed');

      const oldTerminalWrite = (status: 'rolled_back' | 'session_ended' | 'timed_out') =>
        serverDB
          .update(agentInterventionResolutions)
          .set({ status })
          .where(eq(agentInterventionResolutions.id, resolution.id));
      for (const status of ['rolled_back', 'session_ended', 'timed_out'] as const) {
        await expect(oldTerminalWrite(status)).rejects.toThrow();
      }

      const result = { content: 'Installed', pluginState: { agentId: 'agent-a' } };
      expect(
        await model.completeCustomExecution({
          inputHash,
          leaseToken: claimed.leaseToken,
          resolutionRequestId: resolution.resolutionRequestId,
          result,
        }),
      ).toEqual({ outcome: 'completed', result });
      for (const status of ['rolled_back', 'session_ended', 'timed_out'] as const) {
        await expect(oldTerminalWrite(status)).rejects.toThrow();
      }
      expect(await model.findResolutionByRequestId(resolution.resolutionRequestId)).toMatchObject({
        customExecutionState: 'completed',
        status: 'resolving',
      });
    });

    it('rejects the wrong lease, wrong owner, invalid hash, and out-of-bounds duration', async () => {
      const { resolution } = await createCustomResolution();
      const params = {
        inputHash,
        leaseDurationMs,
        resolutionRequestId: resolution.resolutionRequestId,
      };
      const claimed = await model.claimCustomExecution(params);
      if (claimed.outcome !== 'applied') throw new Error('execution lease claim failed');
      const result = { content: 'Installed', pluginState: {} };

      expect(
        await model.completeCustomExecution({
          inputHash,
          leaseToken: randomUUID(),
          resolutionRequestId: resolution.resolutionRequestId,
          result,
        }),
      ).toEqual({ outcome: 'conflict' });
      expect(await otherUserModel.claimCustomExecution(params)).toEqual({ outcome: 'conflict' });
      expect(await model.claimCustomExecution({ ...params, inputHash: 'not-a-sha256' })).toEqual({
        outcome: 'conflict',
      });
      expect(await model.claimCustomExecution({ ...params, leaseDurationMs: 999 })).toEqual({
        outcome: 'conflict',
      });
      expect(await model.claimCustomExecution({ ...params, leaseDurationMs: 900_001 })).toEqual({
        outcome: 'conflict',
      });
    });
  });

  it('preserves bounded marketplace picker detail and whitelists selected agent ids', async () => {
    await expect(
      createQuestionBatch({
        batchId: 'unsafe-marketplace-batch',
        items: [
          questionItem({
            allowedActions: ['submit_custom'],
            interactionKind: 'custom',
            sanitizedRequest: {
              apiName: 'selectMarketplaceAgents',
              customDetail: {
                agents: [{ id: 'a', title: 'Agent A' }],
                kind: 'agent_marketplace',
                rawArguments: '{"secret":true}',
              } as never,
            },
            toolCallId: 'unsafe-marketplace-tool',
          }),
        ],
      }),
    ).rejects.toThrow(AGENT_INTERVENTION_INVALID_BATCH);

    await parkOperation();
    const rows = await model.createBatch({
      activityKey: 'marketplace-activity',
      batchId: 'marketplace-batch',
      deadline: new Date(Date.now() + 60_000),
      items: [
        questionItem({
          allowedActions: ['submit_custom', 'cancel_interaction'],
          interactionKind: 'custom',
          sanitizedRequest: {
            apiName: 'selectMarketplaceAgents',
            customDetail: {
              agents: [
                { avatar: 'https://example.com/a.png', id: 'a', title: 'Agent A' },
                { description: 'Second agent', id: 'b', title: 'Agent B' },
              ],
              categoryHints: ['coding'],
              kind: 'agent_marketplace',
              requestId: 'request-1',
              selectedIds: ['a'],
            },
          },
          toolCallId: 'marketplace-tool',
        }),
      ],
      operationId,
      source: 'runtime',
      stepIndex: 2,
      systemActionEligibility: 'review_only',
    });
    expect(rows[0].sanitizedRequest.customDetail).toMatchObject({
      agents: [
        { id: 'a', title: 'Agent A' },
        { id: 'b', title: 'Agent B' },
      ],
      categoryHints: ['coding'],
      requestId: 'request-1',
      selectedIds: ['a'],
    });
    await expect(
      claim(rows, {
        expectedRevisionHash: rows[0].requestRevisionHash,
        result: { selectedIds: ['forged'] },
        type: 'submit_custom',
      }),
    ).rejects.toThrow(AGENT_INTERVENTION_INVALID_ACTION);
    expect(
      (
        await claim(rows, {
          expectedRevisionHash: rows[0].requestRevisionHash,
          result: { selectedIds: ['a', 'b'] },
          type: 'submit_custom',
        })
      ).outcome,
    ).toBe('applied');
  });

  it('validates answer ids, option whitelist, and scalar/multi cardinality from the row', async () => {
    const rows = await createQuestionBatch({ batchId: 'answers-batch' });
    await expect(
      claim(rows, { answers: { unknown: 'safe' }, type: 'submit_answers' }),
    ).rejects.toThrow(AGENT_INTERVENTION_INVALID_ACTION);
    await expect(
      claim(rows, { answers: { mode: ['safe'] }, type: 'submit_answers' }),
    ).rejects.toThrow(AGENT_INTERVENTION_INVALID_ACTION);
    await expect(claim(rows, { answers: null as never, type: 'submit_answers' })).rejects.toThrow(
      AGENT_INTERVENTION_INVALID_ACTION,
    );
    await expect(
      claim(rows, { answers: { mode: 'unlisted' }, type: 'submit_answers' }),
    ).rejects.toThrow(AGENT_INTERVENTION_INVALID_ACTION);
    expect((await claim(rows, { answers: { mode: 'safe' }, type: 'submit_answers' })).outcome).toBe(
      'applied',
    );
  });

  it('supports explicitly enabled freeform, supplement, and per-question custom answers', async () => {
    const customRows = await createQuestionBatch({
      batchId: 'custom-answer-batch',
      items: [
        questionItem({
          sanitizedRequest: {
            answerPolicy: { allowFreeform: true, allowSupplement: true },
            apiName: 'askUserQuestion',
            questions: [
              {
                allowCustomAnswer: true,
                id: 'mode',
                options: [{ id: 'safe', label: 'Safe' }],
                question: 'Which mode?',
              },
            ],
          },
          toolCallId: 'custom-answer-tool',
        }),
      ],
    });
    expect(
      (
        await claim(customRows, {
          answers: { __supplement__: 'Additional context', mode: 'my-own-mode' },
          type: 'submit_answers',
        })
      ).outcome,
    ).toBe('applied');

    const freeformRows = await createQuestionBatch({
      batchId: 'freeform-answer-batch',
      items: [
        questionItem({
          sanitizedRequest: {
            answerPolicy: { allowFreeform: true },
            apiName: 'askUserQuestion',
            questions: [
              {
                id: 'mode',
                options: [{ id: 'safe', label: 'Safe' }],
                question: 'Which mode?',
              },
            ],
          },
          toolCallId: 'freeform-answer-tool',
        }),
      ],
    });
    expect(
      (
        await claim(freeformRows, {
          answers: { __freeform__: 'Handle this another way' },
          type: 'submit_answers',
        })
      ).outcome,
    ).toBe('applied');

    await expect(
      createQuestionBatch({
        batchId: 'permission-freeform-batch',
        items: [
          questionItem({
            interactionKind: 'permission',
            sanitizedRequest: {
              answerPolicy: { allowFreeform: true },
              apiName: 'requestPermission',
            },
            toolCallId: 'permission-freeform-tool',
          }),
        ],
      }),
    ).rejects.toThrow(AGENT_INTERVENTION_INVALID_ACTION);
  });

  it('validates exact provider option ids and only producer ACK completes heterogeneous rows', async () => {
    const rows = await model.createBatch({
      activityKey: 'provider-activity',
      batchId: 'provider-batch',
      deadline: new Date(Date.now() + 60_000),
      items: [
        questionItem({
          allowedActions: ['select_provider_option', 'cancel_interaction'],
          interactionKind: 'permission',
          sanitizedRequest: {
            apiName: 'requestPermission',
            options: [
              { id: 'allow_once', label: 'Allow once' },
              { id: 'deny', label: 'Deny' },
            ],
          },
          toolCallId: 'permission-tool',
        }),
      ],
      operationId,
      provider: 'claude-code',
      source: 'heterogeneous',
      stepIndex: 1,
      systemActionEligibility: 'review_only',
    });
    await expect(
      claim(rows, { optionId: 'forged', type: 'select_provider_option' }),
    ).rejects.toThrow(AGENT_INTERVENTION_INVALID_ACTION);

    const claimed = await claim(rows, {
      optionId: 'allow_once',
      type: 'select_provider_option',
    });
    if (claimed.outcome !== 'applied') throw new Error('claim failed');
    await model.markResolutionPublished(claimed.resolution.resolutionRequestId);
    await expect(
      model.completeRuntimeResolution(claimed.resolution.resolutionRequestId),
    ).rejects.toThrow(AGENT_INTERVENTION_SOURCE_TRANSITION_MISMATCH);
    expect(
      (await model.acknowledgeProducerResolution(claimed.resolution.resolutionRequestId)).outcome,
    ).toBe('applied');
  });

  it('lets only one concurrent request win and makes exact retries idempotent', async () => {
    const rows = await createQuestionBatch({ batchId: 'race-batch' });
    const requestId = randomUUID();
    const params = {
      action: { answers: { mode: 'safe' }, type: 'submit_answers' } as const,
      actorId,
      batchId: rows[0].batchId,
      operationId,
      resolutionRequestId: requestId,
      scope: 'single' as const,
      selectedInterventionIds: [rows[0].id],
      ...snapshot(rows),
    };
    const [first, second] = await Promise.all([
      model.claimBatch(params),
      model.claimBatch({ ...params, resolutionRequestId: randomUUID() }),
    ]);
    expect([first.outcome, second.outcome].sort()).toEqual(['applied', 'conflict']);

    const winner = first.outcome === 'applied' ? first : second;
    const winnerRequestId = winner.resolution?.resolutionRequestId;
    expect(winnerRequestId).toBeDefined();
    const retry = await model.claimBatch({ ...params, resolutionRequestId: winnerRequestId! });
    expect(retry.outcome).toBe('idempotent');
    await expect(
      model.claimBatch({
        ...params,
        expectedItemCount: params.expectedItemCount + 1,
        resolutionRequestId: winnerRequestId!,
      }),
    ).rejects.toThrow(AGENT_INTERVENTION_RESOLUTION_REQUEST_REUSED);
    await expect(
      model.claimBatch({
        ...params,
        action: { answers: { mode: 'fast' }, type: 'submit_answers' },
        resolutionRequestId: winnerRequestId!,
      }),
    ).rejects.toThrow(AGENT_INTERVENTION_RESOLUTION_REQUEST_REUSED);
  });

  it('reactivates the exact rolled-back request id while the original snapshot is still pending', async () => {
    const rows = await createRuntimeApprovalBatch({ batchId: 'retry-after-rollback' });
    const resolutionRequestId = randomUUID();
    const params = {
      action: { editedArguments: { path: 'retried.txt' }, type: 'approve' } as const,
      actorId: ownerId,
      batchId: rows[0].batchId,
      operationId,
      resolutionRequestId,
      scope: 'single' as const,
      selectedInterventionIds: [rows[0].id],
      ...snapshot(rows),
    };
    const first = await model.claimBatch(params);
    expect(first.outcome).toBe('applied');
    await model.rollbackResolution(resolutionRequestId);

    const retry = await model.claimBatch(params);
    expect(retry.outcome).toBe('applied');
    if (retry.outcome !== 'applied') throw new Error('reactivation failed');
    expect(retry.resolution).toMatchObject({ resolutionRequestId, status: 'resolving' });
    expect(retry.interventions[0]).toMatchObject({
      resolutionId: retry.resolution.id,
      status: 'resolving',
    });
    const [plugin] = await serverDB
      .select({ arguments: messagePlugins.arguments })
      .from(messagePlugins)
      .where(eq(messagePlugins.id, rows[0].toolMessageId!));
    expect(plugin.arguments).toBe('{"path":"retried.txt"}');
  });

  it('does not reactivate a rolled-back request after another request wins', async () => {
    const rows = await createQuestionBatch({ batchId: 'retry-lost-race' });
    const resolutionRequestId = randomUUID();
    const originalParams = {
      action: { answers: { mode: 'safe' }, type: 'submit_answers' } as const,
      actorId,
      batchId: rows[0].batchId,
      operationId,
      resolutionRequestId,
      scope: 'single' as const,
      selectedInterventionIds: [rows[0].id],
      ...snapshot(rows),
    };
    expect((await model.claimBatch(originalParams)).outcome).toBe('applied');
    await model.rollbackResolution(resolutionRequestId);

    const reopened = await model.findBatch(operationId, rows[0].batchId);
    expect(
      (
        await claim(
          reopened.interventions,
          { answers: { mode: 'fast' }, type: 'submit_answers' },
          { resolutionRequestId: randomUUID() },
        )
      ).outcome,
    ).toBe('applied');

    const lostRetry = await model.claimBatch(originalParams);
    expect(lostRetry.outcome).toBe('conflict');
    expect(lostRetry.interventions?.[0].status).toBe('resolving');
  });

  it('atomically appends remember and conditionally removes only its own new key', async () => {
    await serverDB.insert(userSettings).values({
      id: ownerId,
      tool: { humanIntervention: { allowList: ['existing/tool'], approvalMode: 'allow-list' } },
    });
    const rows = await createRuntimeApprovalBatch({ canonicalToolKey: 'filesystem/writeFile' });
    const claimed = await claim(rows, { type: 'approve_remember' }, { actorId: ownerId });
    if (claimed.outcome !== 'applied') throw new Error('claim failed');
    const [afterClaim] = await serverDB
      .select({ tool: userSettings.tool })
      .from(userSettings)
      .where(eq(userSettings.id, ownerId));
    expect(afterClaim.tool).toMatchObject({
      humanIntervention: {
        allowList: ['existing/tool', 'filesystem/writeFile'],
        approvalMode: 'allow-list',
      },
    });

    await model.rollbackResolution(claimed.resolution.resolutionRequestId);
    const [afterRollback] = await serverDB
      .select({ tool: userSettings.tool })
      .from(userSettings)
      .where(eq(userSettings.id, ownerId));
    expect(afterRollback.tool).toMatchObject({
      humanIntervention: { allowList: ['existing/tool'], approvalMode: 'allow-list' },
    });
  });

  it('does not remove a pre-existing or concurrently retained remember key on rollback', async () => {
    await serverDB.insert(userSettings).values({
      id: ownerId,
      tool: { humanIntervention: { allowList: ['filesystem/writeFile'] } },
    });
    const first = await createRuntimeApprovalBatch({ batchId: 'remember-existing' });
    const firstClaim = await claim(first, { type: 'approve_remember' }, { actorId: ownerId });
    if (firstClaim.outcome !== 'applied') throw new Error('claim failed');
    await model.rollbackResolution(firstClaim.resolution.resolutionRequestId);

    const [settings] = await serverDB
      .select({ tool: userSettings.tool })
      .from(userSettings)
      .where(eq(userSettings.id, ownerId));
    expect(settings.tool).toMatchObject({
      humanIntervention: { allowList: ['filesystem/writeFile'] },
    });
  });

  it('keeps a newly remembered key when another active resolution retained it', async () => {
    const first = await createRuntimeApprovalBatch({
      batchId: 'remember-first',
      operationId,
    });
    const second = await createRuntimeApprovalBatch({
      batchId: 'remember-second',
      operationId: secondOperationId,
    });
    const firstClaim = await claim(first, { type: 'approve_remember' }, { actorId: ownerId });
    if (firstClaim.outcome !== 'applied') throw new Error('claim failed');
    const [secondClaim, rolledBack] = await Promise.all([
      claim(second, { type: 'approve_remember' }, { actorId: ownerId }),
      model.rollbackResolution(firstClaim.resolution.resolutionRequestId),
    ]);
    if (secondClaim.outcome !== 'applied') throw new Error('claim failed');
    expect(rolledBack.outcome).toBe('applied');
    const [settings] = await serverDB
      .select({ tool: userSettings.tool })
      .from(userSettings)
      .where(eq(userSettings.id, ownerId));
    expect(settings.tool).toMatchObject({
      humanIntervention: { allowList: ['filesystem/writeFile'] },
    });
  });

  it('edits authoritative arguments in the claim transaction and restores them on rollback', async () => {
    const rows = await createRuntimeApprovalBatch({ batchId: 'edit-batch' });
    const originalArguments = JSON.stringify({ path: 'file-0.txt' });
    const claimed = await claim(
      rows,
      {
        editedArguments: { a: { x: 1, y: 2 }, path: 'edited.txt', z: 1 },
        type: 'approve',
      },
      { actorId: ownerId },
    );
    if (claimed.outcome !== 'applied') throw new Error('claim failed');

    const [pluginAfterEdit] = await serverDB
      .select()
      .from(messagePlugins)
      .where(eq(messagePlugins.id, rows[0].toolMessageId!));
    expect(pluginAfterEdit.arguments).toBe('{"a":{"x":1,"y":2},"path":"edited.txt","z":1}');
    expect(claimed.resolution).toMatchObject({
      argumentEffectStatus: 'applied',
      editedArguments: '{"a":{"x":1,"y":2},"path":"edited.txt","z":1}',
      originalArguments,
    });

    await model.rollbackResolution(claimed.resolution.resolutionRequestId);
    const [pluginAfterRollback] = await serverDB
      .select()
      .from(messagePlugins)
      .where(eq(messagePlugins.id, rows[0].toolMessageId!));
    expect(pluginAfterRollback.arguments).toBe(originalArguments);
    const state = await model.findBatch(operationId, 'edit-batch');
    expect(state.interventions[0]).toMatchObject({
      requestRevisionHash: hashAgentInterventionRequestRevision(originalArguments),
      status: 'pending',
    });
  });

  it('rejects non-JSON-safe edited arguments before mutating the tool message', async () => {
    const rows = await createRuntimeApprovalBatch({ batchId: 'unsafe-edit-batch' });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const sparseArray: unknown[] = [];
    sparseArray.length = 1;
    const unsafeValues: [string, unknown][] = [
      ['undefined', undefined],
      ['date', new Date()],
      ['bigint', 1n],
      ['function', () => true],
      ['symbol', Symbol('unsafe')],
      ['nan', Number.NaN],
      ['infinity', Number.POSITIVE_INFINITY],
      ['negative-infinity', Number.NEGATIVE_INFINITY],
      ['sparse-array', sparseArray],
      ['cycle', cyclic],
    ];

    for (const [, value] of unsafeValues) {
      await expect(
        claim(rows, { editedArguments: { value }, type: 'approve' } as never, { actorId: ownerId }),
      ).rejects.toThrow(AGENT_INTERVENTION_INVALID_ACTION);
    }

    const [plugin] = await serverDB
      .select({ arguments: messagePlugins.arguments })
      .from(messagePlugins)
      .where(eq(messagePlugins.id, rows[0].toolMessageId!));
    expect(plugin.arguments).toBe('{"path":"file-0.txt"}');
    expect((await model.findBatch(operationId, rows[0].batchId)).interventions[0].status).toBe(
      'pending',
    );
  });

  it('fails closed when authoritative arguments no longer match the Review revision', async () => {
    const rows = await createRuntimeApprovalBatch({ batchId: 'stale-args-batch' });
    await serverDB
      .update(messagePlugins)
      .set({ arguments: '{"path":"changed-elsewhere.txt"}' })
      .where(eq(messagePlugins.id, rows[0].toolMessageId!));
    await expect(claim(rows, { type: 'approve' }, { actorId: ownerId })).rejects.toThrow(
      AGENT_INTERVENTION_INVALID_REQUEST_REVISION_HASH,
    );
  });

  it('does not overwrite a newer argument edit during conditional rollback', async () => {
    const rows = await createRuntimeApprovalBatch({ batchId: 'edit-cas-batch' });
    const claimed = await claim(
      rows,
      { editedArguments: { path: 'claimed.txt' }, type: 'approve' },
      { actorId: ownerId },
    );
    if (claimed.outcome !== 'applied') throw new Error('claim failed');
    const newerArguments = '{"path":"newer.txt"}';
    await serverDB
      .update(messagePlugins)
      .set({ arguments: newerArguments })
      .where(eq(messagePlugins.id, rows[0].toolMessageId!));

    const rolledBack = await model.rollbackResolution(claimed.resolution.resolutionRequestId);
    expect(rolledBack.outcome).toBe('applied');
    if (rolledBack.outcome !== 'applied') throw new Error('rollback failed');
    expect(rolledBack.resolution.argumentEffectStatus).toBe('retained');
    const [plugin] = await serverDB
      .select()
      .from(messagePlugins)
      .where(eq(messagePlugins.id, rows[0].toolMessageId!));
    expect(plugin.arguments).toBe(newerArguments);
  });

  it('requires explicit safe single binary eligibility and operation-wide stop scope', async () => {
    await expect(
      createQuestionBatch({ systemActionEligibility: 'safe_single_binary' }),
    ).rejects.toThrow();
    const rows = await createRuntimeApprovalBatch({ count: 2 });
    await expect(claim(rows, { haltScope: 'operation', type: 'stop' })).rejects.toThrow(
      AGENT_INTERVENTION_INVALID_ACTION,
    );
    expect(
      (
        await claim(
          rows,
          { haltScope: 'operation', type: 'stop' },
          {
            actorId: ownerId,
            scope: 'all',
            selectedInterventionIds: rows.map((row) => row.id),
          },
        )
      ).outcome,
    ).toBe('applied');
  });

  it('stops only the remaining pending items in a partially completed sealed batch', async () => {
    const rows = await createRuntimeApprovalBatch({ count: 2 });
    const firstClaim = await claim(rows, { type: 'approve' }, { actorId: ownerId });
    expect(firstClaim.outcome).toBe('applied');
    if (firstClaim.outcome !== 'applied') throw new Error('claim failed');
    await model.markResolutionPublished(firstClaim.resolution.resolutionRequestId);
    await model.completeRuntimeResolution(firstClaim.resolution.resolutionRequestId);

    const partial = await model.findBatch(rows[0].operationId, rows[0].batchId);
    expect(partial.interventions.map((row) => row.status)).toEqual(['resolved', 'pending']);
    const pending = partial.interventions.filter((row) => row.status === 'pending');
    const stopped = await claim(
      partial.interventions,
      { haltScope: 'operation', type: 'stop' },
      {
        actorId: ownerId,
        scope: 'all',
        selectedInterventionIds: pending.map((row) => row.id),
      },
    );

    expect(stopped.outcome).toBe('applied');
    if (stopped.outcome !== 'applied') throw new Error('stop failed');
    expect(stopped.interventions.map((row) => row.status)).toEqual(['resolved', 'resolving']);
    expect(stopped.resolution).toMatchObject({
      action: { haltScope: 'operation', type: 'stop' },
      scope: 'all',
      selectedInterventionIds: pending.map((row) => row.id),
    });
  });

  it('atomically supersedes a partial runtime batch even when the published hook is late', async () => {
    const original = await createRuntimeApprovalBatch({ batchId: 'superseded-batch', count: 2 });
    const claimed = await claim(original, { type: 'approve' }, { actorId: ownerId });
    if (claimed.outcome !== 'applied') throw new Error('claim failed');
    const pending = (await model.findBatch(operationId, 'superseded-batch')).interventions.filter(
      (row) => row.status === 'pending',
    );
    await serverDB
      .update(agentOperations)
      .set({ completionReason: 'waiting_for_human', status: 'waiting_for_human' })
      .where(eq(agentOperations.id, secondOperationId));
    const batch = createReparkBatchParams(pending, { batchId: 'replacement-batch' });
    const supersedes = {
      activityKey: original[0].activityKey,
      batchId: original[0].batchId,
      operationId: original[0].operationId,
      toolCallIds: pending.map((row) => row.toolCallId),
    };

    const replaced = await model.createBatchWithSupersession({ batch, supersedes });
    expect(replaced.outcome).toBe('applied');
    expect(replaced.interventions).toHaveLength(1);
    expect(replaced.interventions[0]).toMatchObject({
      batchId: 'replacement-batch',
      operationId: secondOperationId,
      status: 'pending',
      toolCallId: pending[0].toolCallId,
    });
    expect(replaced.superseded?.interventions.map((row) => row.status)).toEqual([
      'resolved',
      'session_ended',
    ]);
    expect(
      (await model.findResolutionByRequestId(claimed.resolution.resolutionRequestId))?.status,
    ).toBe('completed');
    const operations = await serverDB
      .select({ id: agentOperations.id, status: agentOperations.status })
      .from(agentOperations);
    expect(operations.find(({ id }) => id === operationId)?.status).toBe('done');
    expect(operations.find(({ id }) => id === secondOperationId)?.status).toBe('waiting_for_human');

    expect(
      (await model.markResolutionPublished(claimed.resolution.resolutionRequestId)).outcome,
    ).toBe('idempotent');
    expect(
      (await model.completeRuntimeResolution(claimed.resolution.resolutionRequestId)).outcome,
    ).toBe('idempotent');
    await serverDB
      .update(agentOperations)
      .set({ completionReason: 'done', status: 'done' })
      .where(eq(agentOperations.id, secondOperationId));
    expect((await model.createBatchWithSupersession({ batch, supersedes })).outcome).toBe(
      'idempotent',
    );
  });

  it('supersedes the remaining rows after the prior published hook already completed', async () => {
    const original = await createRuntimeApprovalBatch({ batchId: 'published-first', count: 2 });
    const claimed = await claim(original, { type: 'approve' }, { actorId: ownerId });
    if (claimed.outcome !== 'applied') throw new Error('claim failed');
    await model.markResolutionPublished(claimed.resolution.resolutionRequestId);
    await model.completeRuntimeResolution(claimed.resolution.resolutionRequestId);
    const pending = (await model.findBatch(operationId, 'published-first')).interventions.filter(
      (row) => row.status === 'pending',
    );
    await serverDB
      .update(agentOperations)
      .set({ completionReason: 'waiting_for_human', status: 'waiting_for_human' })
      .where(eq(agentOperations.id, secondOperationId));
    const batch = createReparkBatchParams(pending, { batchId: 'published-first-replacement' });

    const replaced = await model.createBatchWithSupersession({
      batch,
      supersedes: {
        activityKey: original[0].activityKey,
        batchId: original[0].batchId,
        operationId: original[0].operationId,
        toolCallIds: pending.map((row) => row.toolCallId),
      },
    });
    expect(replaced.outcome).toBe('applied');
    expect(replaced.superseded?.interventions.map((row) => row.status)).toEqual([
      'resolved',
      'session_ended',
    ]);
  });

  it('fails supersession closed without leaving a partial replacement batch', async () => {
    const original = await createRuntimeApprovalBatch({ batchId: 'conflicting-old', count: 2 });
    const claimed = await claim(original, { type: 'approve' }, { actorId: ownerId });
    if (claimed.outcome !== 'applied') throw new Error('claim failed');
    const pending = (await model.findBatch(operationId, 'conflicting-old')).interventions.filter(
      (row) => row.status === 'pending',
    );
    await serverDB
      .update(agentOperations)
      .set({ completionReason: 'waiting_for_human', status: 'waiting_for_human' })
      .where(eq(agentOperations.id, secondOperationId));
    const batch = createReparkBatchParams(pending, { batchId: 'must-not-exist' });

    await expect(
      model.createBatchWithSupersession({
        batch,
        supersedes: {
          activityKey: original[0].activityKey,
          batchId: original[0].batchId,
          operationId: original[0].operationId,
          toolCallIds: ['not-the-pending-tool'],
        },
      }),
    ).rejects.toThrow(AGENT_INTERVENTION_IDENTITY_CONFLICT);
    expect((await model.findBatch(secondOperationId, 'must-not-exist')).interventions).toEqual([]);
    expect(
      (await model.findBatch(operationId, 'conflicting-old')).interventions.map(
        (row) => row.status,
      ),
    ).toEqual(['resolving', 'pending']);
  });

  it('never supersedes a stopped runtime batch into a new parked batch', async () => {
    const original = await createRuntimeApprovalBatch({ batchId: 'stopped-old', count: 2 });
    const claimed = await claim(original, { type: 'approve' }, { actorId: ownerId });
    if (claimed.outcome !== 'applied') throw new Error('claim failed');
    await serverDB
      .update(agentInterventionResolutions)
      .set({ action: { haltScope: 'operation', type: 'stop' } })
      .where(eq(agentInterventionResolutions.id, claimed.resolution.id));
    const pending = (await model.findBatch(operationId, 'stopped-old')).interventions.filter(
      (row) => row.status === 'pending',
    );
    await serverDB
      .update(agentOperations)
      .set({ completionReason: 'waiting_for_human', status: 'waiting_for_human' })
      .where(eq(agentOperations.id, secondOperationId));
    const batch = createReparkBatchParams(pending, { batchId: 'must-not-repark-stop' });

    await expect(
      model.createBatchWithSupersession({
        batch,
        supersedes: {
          activityKey: original[0].activityKey,
          batchId: original[0].batchId,
          operationId: original[0].operationId,
          toolCallIds: pending.map((row) => row.toolCallId),
        },
      }),
    ).rejects.toThrow(AGENT_INTERVENTION_IDENTITY_CONFLICT);
    expect(
      (await model.findBatch(secondOperationId, 'must-not-repark-stop')).interventions,
    ).toEqual([]);
  });

  it('rejects a replacement operation from a different conversation context', async () => {
    await serverDB
      .update(agentOperations)
      .set({ appContext: { scope: 'main', sessionId: 'agent-a' } })
      .where(eq(agentOperations.id, operationId));
    await serverDB
      .update(agentOperations)
      .set({ appContext: { scope: 'thread', sessionId: 'agent-a' } })
      .where(eq(agentOperations.id, secondOperationId));
    const original = await createRuntimeApprovalBatch({ batchId: 'context-old', count: 2 });
    const claimed = await claim(original, { type: 'approve' }, { actorId: ownerId });
    if (claimed.outcome !== 'applied') throw new Error('claim failed');
    const pending = (await model.findBatch(operationId, 'context-old')).interventions.filter(
      (row) => row.status === 'pending',
    );
    await serverDB
      .update(agentOperations)
      .set({ completionReason: 'waiting_for_human', status: 'waiting_for_human' })
      .where(eq(agentOperations.id, secondOperationId));

    await expect(
      model.createBatchWithSupersession({
        batch: createReparkBatchParams(pending, { batchId: 'wrong-context' }),
        supersedes: {
          activityKey: original[0].activityKey,
          batchId: original[0].batchId,
          operationId: original[0].operationId,
          toolCallIds: pending.map((row) => row.toolCallId),
        },
      }),
    ).rejects.toThrow(AGENT_INTERVENTION_IDENTITY_CONFLICT);
    expect((await model.findBatch(secondOperationId, 'wrong-context')).interventions).toEqual([]);
  });

  it('retires the exact parked operation when a runtime continuation completes', async () => {
    const rows = await createRuntimeApprovalBatch({ batchId: 'retire-operation' });
    const claimed = await claim(rows, { type: 'reject_continue' }, { actorId: ownerId });
    if (claimed.outcome !== 'applied') throw new Error('claim failed');
    await model.markResolutionPublished(claimed.resolution.resolutionRequestId);
    expect(
      (await model.completeRuntimeResolution(claimed.resolution.resolutionRequestId)).outcome,
    ).toBe('applied');
    const [operation] = await serverDB
      .select({ completedAt: agentOperations.completedAt, status: agentOperations.status })
      .from(agentOperations)
      .where(eq(agentOperations.id, operationId));
    expect(operation.status).toBe('done');
    expect(operation.completedAt).toBeInstanceOf(Date);
  });

  it('times out items and the active outbox atomically, then records a late ACK only as audit', async () => {
    const rows = await createQuestionBatch({ batchId: 'timeout-batch' });
    const claimed = await claim(rows, { answers: { mode: 'safe' }, type: 'submit_answers' });
    if (claimed.outcome !== 'applied') throw new Error('claim failed');
    await model.markResolutionPublished(claimed.resolution.resolutionRequestId);

    const terminal = await model.markBatchTerminal(
      operationId,
      'timeout-batch',
      'timed_out',
      new Date(Date.now() + 20 * 60_000),
    );
    expect(terminal[0].status).toBe('timed_out');
    const state = await model.findBatch(operationId, 'timeout-batch');
    expect(state.resolutions[0]).toMatchObject({ status: 'timed_out' });
    expect((await model.recordProducerAck(claimed.resolution.resolutionRequestId)).outcome).toBe(
      'applied',
    );
    expect((await model.findBatch(operationId, 'timeout-batch')).interventions[0].status).toBe(
      'timed_out',
    );
  });

  it('synchronizes an active outbox when claim discovers an overdue batch', async () => {
    const rows = await createQuestionBatch({ batchId: 'claim-overdue-batch' });
    const claimed = await claim(rows, { answers: { mode: 'safe' }, type: 'submit_answers' });
    if (claimed.outcome !== 'applied') throw new Error('claim failed');
    await model.markResolutionPublished(claimed.resolution.resolutionRequestId);
    const published = await model.findBatch(operationId, 'claim-overdue-batch');
    await serverDB
      .update(agentInterventions)
      .set({ deadline: new Date(Date.now() - 1000) })
      .where(eq(agentInterventions.id, rows[0].id));

    const result = await claim(
      published.interventions,
      { answers: { mode: 'safe' }, type: 'submit_answers' },
      { resolutionRequestId: randomUUID() },
    );
    expect(result.outcome).toBe('conflict');
    expect(result.interventions?.[0].status).toBe('timed_out');
    expect(
      (await model.findResolutionByRequestId(claimed.resolution.resolutionRequestId))?.status,
    ).toBe('timed_out');
  });

  it('recovers owner scope from a resolution request without treating actor as owner', async () => {
    const rows = await createQuestionBatch({ batchId: 'resolution-locator-batch' });
    const claimed = await claim(rows, { answers: { mode: 'safe' }, type: 'submit_answers' });
    if (claimed.outcome !== 'applied') throw new Error('claim failed');
    expect(
      await AgentInterventionModel.locateByResolutionRequestId(
        serverDB,
        claimed.resolution.resolutionRequestId,
      ),
    ).toEqual({
      batchId: 'resolution-locator-batch',
      operationId,
      source: 'heterogeneous',
      userId: ownerId,
      workspaceId,
    });
  });
});
