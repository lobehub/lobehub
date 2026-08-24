// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentOperations, heterogeneousAgentInterventions, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  HETERO_INTERVENTION_IDENTITY_CONFLICT,
  HETERO_INTERVENTION_INVALID_PROVIDER_OPTIONS,
  HETERO_INTERVENTION_INVALID_REVIEW_TOKEN_HASH,
  HETERO_INTERVENTION_RESOLUTION_REQUEST_REUSED,
  HeterogeneousAgentInterventionModel,
} from '../heterogeneousAgentIntervention';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'hetero-intervention-owner';
const otherUserId = 'hetero-intervention-other';
const workspaceId = 'hetero-intervention-workspace';
const operationId = 'hetero-intervention-operation';
const secondOperationId = 'hetero-intervention-operation-2';

const model = new HeterogeneousAgentInterventionModel(serverDB, ownerId, workspaceId);
const coldStartModel = new HeterogeneousAgentInterventionModel(serverDB, ownerId);
const otherUserModel = new HeterogeneousAgentInterventionModel(serverDB, otherUserId, workspaceId);

let hashSequence = 0;
const nextReviewTokenHash = () => (++hashSequence).toString(16).padStart(64, 'a');

const createIntervention = (overrides: Partial<Parameters<typeof model.create>[0]> = {}) =>
  model.create({
    deadline: new Date(Date.now() + 10 * 60 * 1000),
    interactionKind: 'question',
    operationId,
    provider: 'claude-code',
    reviewContext: {
      summary: 'Choose one safe option',
      title: 'Agent needs your input',
    },
    reviewTokenHash: nextReviewTokenHash(),
    sanitizedRequest: {
      apiName: 'askUserQuestion',
      identifier: 'claude-code',
      questions: [
        {
          header: 'Mode',
          id: 'question-mode',
          options: [
            { id: 'safe', label: 'Safe mode' },
            { id: 'fast', label: 'Fast mode' },
          ],
          question: 'Which mode should be used?',
        },
      ],
    },
    toolCallId: 'tool-call-1',
    ...overrides,
  });

beforeEach(async () => {
  hashSequence = 0;
  await serverDB.delete(heterogeneousAgentInterventions);
  await serverDB.delete(agentOperations);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: ownerId }, { id: otherUserId }]);
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'Intervention workspace',
    primaryOwnerId: ownerId,
    slug: 'hetero-intervention-workspace',
  });
  await serverDB.insert(agentOperations).values([
    {
      id: operationId,
      status: 'running',
      userId: ownerId,
      workspaceId,
    },
    {
      id: secondOperationId,
      status: 'running',
      userId: ownerId,
      workspaceId,
    },
  ]);
});

describe('HeterogeneousAgentInterventionModel', () => {
  describe('create and owner-scoped Review lookup', () => {
    it('persists a complete cold-start Review request without raw arguments', async () => {
      const row = await createIntervention();

      expect(row).toMatchObject({
        interactionKind: 'question',
        operationId,
        provider: 'claude-code',
        status: 'pending',
        toolCallId: 'tool-call-1',
        userId: ownerId,
        version: 1,
        workspaceId,
      });
      expect(row.sanitizedRequest.questions?.[0]).toMatchObject({
        id: 'question-mode',
        options: [
          { id: 'safe', label: 'Safe mode' },
          { id: 'fast', label: 'Fast mode' },
        ],
      });
      expect(row.resolutionPayload).toBeNull();
      expect(row.producerAckAt).toBeNull();
    });

    it('is idempotent per operation/tool call while allowing many callbacks per operation', async () => {
      const first = await createIntervention();
      const duplicate = await createIntervention({
        reviewContext: { title: 'Duplicate event must not overwrite' },
        reviewTokenHash: nextReviewTokenHash(),
      });
      const secondCallback = await createIntervention({
        reviewTokenHash: nextReviewTokenHash(),
        toolCallId: 'tool-call-2',
      });

      expect(duplicate.id).toBe(first.id);
      expect(duplicate.reviewTokenHash).toBe(first.reviewTokenHash);
      expect(duplicate.reviewContext.title).toBe('Agent needs your input');
      expect(secondCallback.id).not.toBe(first.id);

      const rows = await serverDB
        .select()
        .from(heterogeneousAgentInterventions)
        .where(eq(heterogeneousAgentInterventions.operationId, operationId));
      expect(rows).toHaveLength(2);
    });

    it('refuses to attach an intervention to another owner operation', async () => {
      await expect(
        otherUserModel.create({
          deadline: new Date(Date.now() + 10 * 60 * 1000),
          interactionKind: 'question',
          operationId,
          provider: 'claude-code',
          reviewContext: { title: 'Must remain owner scoped' },
          reviewTokenHash: nextReviewTokenHash(),
          sanitizedRequest: {
            apiName: 'askUserQuestion',
            questions: [
              {
                options: [{ label: 'Continue' }],
                question: 'Continue?',
              },
            ],
          },
          toolCallId: 'foreign-operation-tool',
        }),
      ).rejects.toThrow(HETERO_INTERVENTION_IDENTITY_CONFLICT);
    });

    it('stores only a locator hash and requires authenticated owner scope to read it', async () => {
      const reviewTokenHash = nextReviewTokenHash();
      const row = await createIntervention({ reviewTokenHash });

      // Universal Link cold start has an authenticated user but no workspace
      // header yet; token lookup must still recover the workspace-owned row.
      await expect(coldStartModel.findByReviewTokenHash(reviewTokenHash)).resolves.toMatchObject({
        id: row.id,
        workspaceId,
      });
      await expect(otherUserModel.findByReviewTokenHash(reviewTokenHash)).resolves.toBeUndefined();
      await expect(model.findByReviewTokenHash('raw-review-token')).resolves.toBeUndefined();
      await expect(model.findByReviewTokenHash('A'.repeat(64))).resolves.toBeUndefined();
      await expect(
        createIntervention({ reviewTokenHash: 'raw-review-token', toolCallId: 'bad-token' }),
      ).rejects.toThrow(HETERO_INTERVENTION_INVALID_REVIEW_TOKEN_HASH);
    });

    it('returns workspace context for cold-start lookup, then requires a scoped model to claim', async () => {
      const row = await createIntervention();
      const located = await coldStartModel.findByReviewTokenHash(row.reviewTokenHash);
      expect(located?.workspaceId).toBe(workspaceId);

      await expect(
        coldStartModel.claim(row.id, {
          resolutionPayload: { result: { 'Which mode should be used?': 'safe' } },
          resolutionRequestId: randomUUID(),
        }),
      ).resolves.toEqual({ outcome: 'not_found' });

      const scopedModel = new HeterogeneousAgentInterventionModel(
        serverDB,
        ownerId,
        located!.workspaceId!,
      );
      await expect(
        scopedModel.claim(row.id, {
          resolutionPayload: { result: { 'Which mode should be used?': 'safe' } },
          resolutionRequestId: randomUUID(),
        }),
      ).resolves.toMatchObject({ outcome: 'applied' });
    });

    it('locates an ActivityKit registration target by owner before restoring workspace scope', async () => {
      const row = await createIntervention();

      await expect(coldStartModel.findByIdForOwner(row.id)).resolves.toMatchObject({
        id: row.id,
        operationId,
        workspaceId,
      });
      await expect(otherUserModel.findByIdForOwner(row.id)).resolves.toBeUndefined();
      await expect(coldStartModel.findByIdForOwner('not-a-uuid')).resolves.toBeUndefined();

      // The existing scoped read remains fail-closed until Cloud rebuilds the
      // model with the workspace returned by the owner-only locator.
      await expect(coldStartModel.findById(row.id)).resolves.toBeUndefined();
    });

    it('preserves label-only question options and accepts their original answer structure', async () => {
      const row = await createIntervention({
        sanitizedRequest: {
          apiName: 'askUserQuestion',
          questions: [
            {
              header: 'Style',
              options: [{ label: 'Concise' }, { label: 'Detailed' }],
              question: 'How should I respond?',
            },
          ],
        },
      });

      expect(row.sanitizedRequest.questions?.[0].options).toEqual([
        { label: 'Concise' },
        { label: 'Detailed' },
      ]);
      await expect(
        model.claim(row.id, {
          resolutionPayload: { result: { 'How should I respond?': 'Concise' } },
          resolutionRequestId: randomUUID(),
        }),
      ).resolves.toMatchObject({ outcome: 'applied' });
    });

    it('stores only canonical string, multi-select, and freeform question answers', async () => {
      const multiSelect = await createIntervention({
        sanitizedRequest: {
          apiName: 'askUserQuestion',
          questions: [
            {
              header: 'Modes',
              multiSelect: true,
              options: [{ label: 'Safe' }, { label: 'Fast' }],
              question: 'Which modes?',
            },
          ],
        },
      });
      await expect(
        model.claim(multiSelect.id, {
          resolutionPayload: {
            result: {
              'Which modes?': ['Safe', 'Fast'],
              '__supplement__': 'Prefer Safe when they conflict.',
            },
          },
          resolutionRequestId: randomUUID(),
        }),
      ).resolves.toMatchObject({
        intervention: {
          resolutionPayload: {
            result: {
              'Which modes?': ['Safe', 'Fast'],
              '__supplement__': 'Prefer Safe when they conflict.',
            },
          },
        },
        outcome: 'applied',
      });

      const freeform = await createIntervention({
        operationId: secondOperationId,
        reviewTokenHash: nextReviewTokenHash(),
        toolCallId: 'freeform-tool',
      });
      await expect(
        model.claim(freeform.id, {
          resolutionPayload: { result: { __freeform__: 'Use the safest approach.' } },
          resolutionRequestId: randomUUID(),
        }),
      ).resolves.toMatchObject({
        intervention: {
          resolutionPayload: { result: { __freeform__: 'Use the safest approach.' } },
        },
        outcome: 'applied',
      });
    });

    it('requires exact option ids for permission/plan persistence and resolution', async () => {
      const permissionRequest = {
        apiName: 'askUserQuestion',
        questions: [
          {
            header: 'Permission',
            options: [
              { id: 'allow_once', label: 'Allow' },
              { id: 'deny', label: 'Deny' },
            ],
            question: 'Edit README?',
          },
        ],
      };

      await expect(
        createIntervention({
          interactionKind: 'permission',
          operationId: secondOperationId,
          reviewTokenHash: nextReviewTokenHash(),
          sanitizedRequest: {
            ...permissionRequest,
            questions: [
              {
                ...permissionRequest.questions[0],
                options: [{ label: 'Allow' }, { id: 'deny', label: 'Deny' }],
              },
            ],
          },
          toolCallId: 'permission-tool',
        }),
      ).rejects.toThrow(HETERO_INTERVENTION_INVALID_PROVIDER_OPTIONS);

      await expect(
        createIntervention({
          interactionKind: 'permission',
          operationId: secondOperationId,
          reviewTokenHash: nextReviewTokenHash(),
          sanitizedRequest: {
            ...permissionRequest,
            questions: [
              permissionRequest.questions[0],
              {
                ...permissionRequest.questions[0],
                question: 'Run tests?',
              },
            ],
          },
          toolCallId: 'multi-question-permission-tool',
        }),
      ).rejects.toThrow(HETERO_INTERVENTION_INVALID_PROVIDER_OPTIONS);

      await expect(
        createIntervention({
          interactionKind: 'permission',
          operationId: secondOperationId,
          reviewTokenHash: nextReviewTokenHash(),
          sanitizedRequest: {
            ...permissionRequest,
            questions: [{ ...permissionRequest.questions[0], multiSelect: true }],
          },
          toolCallId: 'multi-select-permission-tool',
        }),
      ).rejects.toThrow(HETERO_INTERVENTION_INVALID_PROVIDER_OPTIONS);

      const row = await createIntervention({
        interactionKind: 'permission',
        operationId: secondOperationId,
        reviewTokenHash: nextReviewTokenHash(),
        sanitizedRequest: permissionRequest,
        toolCallId: 'permission-tool',
      });
      await expect(
        model.claim(row.id, {
          resolutionPayload: { result: { 'Edit README?': 'Allow' } },
          resolutionRequestId: randomUUID(),
        }),
      ).rejects.toThrow(HETERO_INTERVENTION_INVALID_PROVIDER_OPTIONS);
      await expect(
        model.claim(row.id, {
          resolutionPayload: { result: { 'Edit README?': ['allow_once'] } },
          resolutionRequestId: randomUUID(),
        }),
      ).rejects.toThrow(HETERO_INTERVENTION_INVALID_PROVIDER_OPTIONS);
      await expect(
        model.claim(row.id, {
          resolutionPayload: {
            result: { 'Edit README?': 'allow_once', 'Run tests?': 'allow_once' },
          },
          resolutionRequestId: randomUUID(),
        }),
      ).rejects.toThrow(HETERO_INTERVENTION_INVALID_PROVIDER_OPTIONS);
      await expect(
        model.claim(row.id, {
          resolutionPayload: { cancelled: true },
          resolutionRequestId: randomUUID(),
        }),
      ).rejects.toThrow(HETERO_INTERVENTION_INVALID_PROVIDER_OPTIONS);
      await expect(
        model.claim(row.id, {
          resolutionPayload: { result: { 'Edit README?': 'allow_once' } },
          resolutionRequestId: randomUUID(),
        }),
      ).resolves.toMatchObject({ outcome: 'applied' });
    });

    it('stores plan as its own semantic kind instead of collapsing it into permission', async () => {
      const row = await createIntervention({
        interactionKind: 'plan',
        operationId: secondOperationId,
        reviewTokenHash: nextReviewTokenHash(),
        sanitizedRequest: {
          apiName: 'askUserQuestion',
          questions: [
            {
              header: 'Plan approval',
              options: [
                { id: 'accepted', label: 'Accept' },
                { id: 'rejected', label: 'Reject' },
              ],
              question: 'Implement the proposed plan?',
            },
          ],
        },
        toolCallId: 'plan-tool',
      });

      expect(row.interactionKind).toBe('plan');
    });
  });

  describe('first-winner resolution', () => {
    it('atomically lets exactly one concurrent Web/Mobile claim win', async () => {
      const row = await createIntervention();
      const webRequestId = randomUUID();
      const mobileRequestId = randomUUID();

      const [web, mobile] = await Promise.all([
        model.claim(row.id, {
          resolutionPayload: { result: { 'Which mode should be used?': 'safe' } },
          resolutionRequestId: webRequestId,
        }),
        model.claim(row.id, {
          resolutionPayload: { result: { 'Which mode should be used?': 'fast' } },
          resolutionRequestId: mobileRequestId,
        }),
      ]);

      expect([web.outcome, mobile.outcome].sort()).toEqual(['applied', 'conflict']);
      const winner = web.outcome === 'applied' ? web : mobile;
      expect(winner.intervention).toBeDefined();
      const current = await model.findById(row.id);
      expect(current).toMatchObject({
        resolutionActorId: ownerId,
        resolutionRequestId: winner.intervention!.resolutionRequestId,
        status: 'resolving',
        version: 2,
      });
      expect(current?.producerAckAt).toBeNull();
      expect(current?.resolvedAt).toBeNull();
    });

    it('treats the same request id as idempotent and preserves its first payload', async () => {
      const row = await createIntervention();
      const resolutionRequestId = randomUUID();

      await expect(
        model.claim(row.id, {
          resolutionPayload: { result: { 'Which mode should be used?': 'safe' } },
          resolutionRequestId,
        }),
      ).resolves.toMatchObject({ outcome: 'applied' });

      const retried = await model.claim(row.id, {
        resolutionPayload: { result: { 'Which mode should be used?': 'fast' } },
        resolutionRequestId,
      });
      expect(retried).toMatchObject({ outcome: 'idempotent' });
      expect(retried.intervention?.resolutionPayload).toEqual({
        result: { 'Which mode should be used?': 'safe' },
      });
    });

    it('does not allow one client request UUID to claim a second intervention', async () => {
      const first = await createIntervention();
      const second = await createIntervention({
        operationId: secondOperationId,
        reviewTokenHash: nextReviewTokenHash(),
        toolCallId: 'tool-call-2',
      });
      const reusedRequestId = randomUUID();

      await model.claim(first.id, {
        resolutionPayload: { result: { 'Which mode should be used?': 'safe' } },
        resolutionRequestId: reusedRequestId,
      });
      await expect(
        model.claim(second.id, {
          resolutionPayload: { result: { 'Which mode should be used?': 'fast' } },
          resolutionRequestId: reusedRequestId,
        }),
      ).rejects.toThrow(HETERO_INTERVENTION_RESOLUTION_REQUEST_REUSED);
    });

    it('never exposes or mutates another authenticated owner row', async () => {
      const row = await createIntervention();
      await expect(
        otherUserModel.claim(row.id, {
          resolutionPayload: { result: { 'Which mode should be used?': 'safe' } },
          resolutionRequestId: randomUUID(),
        }),
      ).resolves.toEqual({ outcome: 'not_found' });
      await expect(otherUserModel.findById(row.id)).resolves.toBeUndefined();
    });
  });

  describe('conditional rollback and producer acknowledgement', () => {
    it('rolls back only the matching unresolved claim and permits a safe retry', async () => {
      const row = await createIntervention();
      const firstRequestId = randomUUID();
      const otherRequestId = randomUUID();
      await model.claim(row.id, {
        resolutionPayload: { result: { 'Which mode should be used?': 'safe' } },
        resolutionRequestId: firstRequestId,
      });

      await expect(model.rollbackClaim(row.id, otherRequestId)).resolves.toMatchObject({
        outcome: 'conflict',
      });
      const rolledBack = await model.rollbackClaim(row.id, firstRequestId);
      expect(rolledBack).toMatchObject({
        intervention: {
          resolutionPayload: null,
          resolutionRequestId: null,
          status: 'pending',
          version: 3,
        },
        outcome: 'applied',
      });
      await expect(model.rollbackClaim(row.id, firstRequestId)).resolves.toMatchObject({
        outcome: 'idempotent',
      });

      await expect(
        model.claim(row.id, {
          resolutionPayload: { result: { 'Which mode should be used?': 'fast' } },
          resolutionRequestId: otherRequestId,
        }),
      ).resolves.toMatchObject({ outcome: 'applied' });
    });

    it('does not report success until the producer ACK atomically resolves the winner', async () => {
      const row = await createIntervention();
      const resolutionRequestId = randomUUID();
      await model.claim(row.id, {
        resolutionPayload: { result: { 'Which mode should be used?': 'safe' } },
        resolutionRequestId,
      });

      const beforeAck = await model.findById(row.id);
      expect(beforeAck).toMatchObject({ producerAckAt: null, status: 'resolving' });

      const acknowledged = await model.acknowledgeResolution(row.id, {
        resolutionRequestId,
        status: 'resolved',
      });
      expect(acknowledged).toMatchObject({
        intervention: {
          resolutionRequestId,
          status: 'resolved',
          version: 3,
        },
        outcome: 'applied',
      });
      expect(acknowledged.intervention?.producerAckAt).toBeInstanceOf(Date);
      expect(acknowledged.intervention?.resolvedAt).toEqual(
        acknowledged.intervention?.producerAckAt,
      );

      await expect(
        model.acknowledgeResolution(row.id, {
          resolutionRequestId,
          status: 'resolved',
        }),
      ).resolves.toMatchObject({ outcome: 'idempotent' });
      await expect(model.rollbackClaim(row.id, resolutionRequestId)).resolves.toMatchObject({
        outcome: 'conflict',
      });
    });

    it('supports a producer-acknowledged user cancellation as a distinct terminal state', async () => {
      const row = await createIntervention();
      const resolutionRequestId = randomUUID();
      await model.claim(row.id, {
        resolutionPayload: { cancelReason: 'user_cancelled', cancelled: true },
        resolutionRequestId,
      });

      await expect(
        model.acknowledgeResolution(row.id, {
          resolutionRequestId,
          status: 'cancelled',
        }),
      ).resolves.toMatchObject({
        intervention: { status: 'cancelled' },
        outcome: 'applied',
      });
    });
  });

  describe('timeout and session terminal states', () => {
    it('lazily turns an overdue open request into timed_out and rejects later claims', async () => {
      const row = await createIntervention({ deadline: new Date(Date.now() - 1000) });
      const timedOut = await model.findById(row.id);
      expect(timedOut).toMatchObject({ status: 'timed_out', version: 2 });
      expect(timedOut?.resolvedAt).toBeInstanceOf(Date);

      await expect(
        model.claim(row.id, {
          resolutionPayload: { result: { 'Which mode should be used?': 'safe' } },
          resolutionRequestId: randomUUID(),
        }),
      ).resolves.toMatchObject({
        intervention: { status: 'timed_out' },
        outcome: 'conflict',
      });
    });

    it('does not time out before deadline and records session teardown separately', async () => {
      const row = await createIntervention();
      await expect(model.markTerminal(row.id, { status: 'timed_out' })).resolves.toMatchObject({
        intervention: { status: 'pending' },
        outcome: 'conflict',
      });

      const ended = await model.markTerminal(row.id, { status: 'session_ended' });
      expect(ended).toMatchObject({
        intervention: { producerAckAt: null, status: 'session_ended' },
        outcome: 'applied',
      });

      const acked = await model.recordProducerAck(row.id);
      expect(acked).toMatchObject({
        intervention: { status: 'session_ended' },
        outcome: 'applied',
      });
      expect(acked.intervention?.producerAckAt).toBeInstanceOf(Date);
      await expect(model.recordProducerAck(row.id)).resolves.toMatchObject({
        outcome: 'idempotent',
      });
    });
  });
});
