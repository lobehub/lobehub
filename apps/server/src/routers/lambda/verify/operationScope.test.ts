import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as FileModelModule from '@/database/models/file';

import { verifyRouter } from '.';

const modelMocks = vi.hoisted(() => ({
  createEvidence: vi.fn(),
  createManyEvidence: vi.fn(),
  findFileById: vi.fn(),
  findResultById: vi.fn(),
  findRunById: vi.fn(),
  findRoundForOperation: vi.fn(),
  findRunByOperation: vi.fn(),
  getStateByOperation: vi.fn(),
  listResultsByRun: vi.fn(),
  upsertByCheckItem: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));

vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(function () {
    return {
      findById: modelMocks.findResultById,
      listByRun: modelMocks.listResultsByRun,
      upsertByCheckItem: modelMocks.upsertByCheckItem,
    };
  }),
}));

vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(function () {
    return {
      findByOperation: modelMocks.findRunByOperation,
      findById: modelMocks.findRunById,
      findRoundForOperation: modelMocks.findRoundForOperation,
      getStateByOperation: modelMocks.getStateByOperation,
    };
  }),
}));

vi.mock('@/database/models/file', async (importOriginal) => {
  const actual = await importOriginal<typeof FileModelModule>();
  class FileModel extends actual.FileModel {
    findById = modelMocks.findFileById as unknown as actual.FileModel['findById'];
  }
  return { ...actual, FileModel };
});

vi.mock('@/database/models/verifyEvidence', () => ({
  VerifyEvidenceModel: vi.fn(function () {
    return { create: modelMocks.createEvidence, createMany: modelMocks.createManyEvidence };
  }),
}));

// The router context builds a FileService, which needs S3 env without this.
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function () {
    return { getFullFileUrl: vi.fn() };
  }),
}));

const USER_ID = 'operation-owner';
const OWN_OPERATION = 'op_own';

/** A caller holding a Task run's operation token, as `oidcAuth` lets it through. */
const createOperationCaller = () =>
  verifyRouter.createCaller({ heteroOperationScope: OWN_OPERATION, userId: USER_ID } as any);

const ownRun = { id: 'run-own', operationId: OWN_OPERATION, plan: [], userId: USER_ID };
const otherRun = { id: 'run-other', operationId: 'op_other', plan: [], userId: USER_ID };

describe("verifyRouter with a run's operation token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelMocks.listResultsByRun.mockResolvedValue([]);
    modelMocks.findFileById.mockResolvedValue(undefined);
    // An operation with a round of its own resolves to it; the topic fallback
    // is exercised by the later-run cases below.
    modelMocks.findRoundForOperation.mockImplementation((operationId: string) =>
      modelMocks.findRunByOperation(operationId),
    );
  });

  it('files evidence into its own round by operation id', async () => {
    modelMocks.findRunByOperation.mockResolvedValueOnce(ownRun);
    modelMocks.upsertByCheckItem.mockResolvedValueOnce({ id: 'result-1', verifyRunId: 'run-own' });
    modelMocks.createManyEvidence.mockResolvedValueOnce([{ id: 'evidence-1' }]);

    await createOperationCaller().submitCheckEvidence({
      checkItemId: 'item-1',
      evidence: [{ fileId: 'files-1', type: 'screenshot' }],
      operationId: OWN_OPERATION,
    });

    expect(modelMocks.upsertByCheckItem).toHaveBeenCalledWith(
      expect.objectContaining({ checkItemId: 'item-1', verifyRunId: 'run-own' }),
    );
    expect(modelMocks.createManyEvidence).toHaveBeenCalledWith([
      expect.objectContaining({ checkResultId: 'result-1', fileId: 'files-1' }),
    ]);
  });

  it("refuses another operation's round, by operation id or by run id", async () => {
    modelMocks.findRunByOperation.mockResolvedValueOnce(otherRun);
    await expect(
      createOperationCaller().submitCheckEvidence({
        checkItemId: 'item-1',
        operationId: 'op_other',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    modelMocks.findRunById.mockResolvedValueOnce(otherRun);
    await expect(
      createOperationCaller().submitCheckEvidence({
        checkItemId: 'item-1',
        verifyRunId: 'run-other',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(modelMocks.upsertByCheckItem).not.toHaveBeenCalled();
  });

  /** Regression: a token could dispute a check of another operation owned by the same principal. */
  it("refuses to dispute another operation's round", async () => {
    modelMocks.findRunByOperation.mockResolvedValueOnce(otherRun);

    await expect(
      createOperationCaller().disputeCheck({
        checkItemId: 'item-1',
        kind: 'invalid_criterion',
        operationId: 'op_other',
        reason: 'Out of scope',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(modelMocks.upsertByCheckItem).not.toHaveBeenCalled();
  });

  it('keeps the observation a plan-round ingest sends', async () => {
    modelMocks.findRunByOperation.mockResolvedValueOnce(ownRun);
    modelMocks.upsertByCheckItem.mockResolvedValueOnce({ id: 'result-1', verifyRunId: 'run-own' });

    await createOperationCaller().submitCheckEvidence({
      checkItemId: 'item-1',
      operationId: OWN_OPERATION,
      toulmin: { evidence: 'Ports are closed and git is clean after cleanup.' },
    });

    expect(modelMocks.upsertByCheckItem).toHaveBeenCalledWith(
      expect.objectContaining({
        toulmin: { evidence: 'Ports are closed and git is clean after cleanup.' },
        verdict: undefined,
      }),
    );
  });

  it.each([
    ['a verdict', { verdict: 'passed' as const }],
    ['a terminal status', { status: 'passed' as const }],
    ['a confidence', { confidence: 1 }],
    ['required-ness', { required: false }],
    ['a verifier type', { verifierType: 'agent' as const }],
    ['a title', { checkItemTitle: 'Renamed check' }],
    ['a suggestion', { suggestion: 'Ship it' }],
    ['Toulmin reasoning', { toulmin: { evidence: 'seen', reasoning: 'so it passes' } }],
  ])('refuses %s, which only the verifier sets', async (_label, authored) => {
    // A prompt-injected Task must not settle its own check before the
    // independent verifier judges the evidence.
    modelMocks.findRunByOperation.mockResolvedValue(ownRun);

    await expect(
      createOperationCaller().submitCheckEvidence({
        checkItemId: 'item-1',
        operationId: OWN_OPERATION,
        ...authored,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(modelMocks.upsertByCheckItem).not.toHaveBeenCalled();
  });

  it('lets a user session submit a verdict', async () => {
    modelMocks.findRunByOperation.mockResolvedValueOnce(ownRun);
    modelMocks.upsertByCheckItem.mockResolvedValueOnce({ id: 'result-1', verifyRunId: 'run-own' });

    await verifyRouter.createCaller({ userId: USER_ID } as any).submitCheckEvidence({
      checkItemId: 'item-1',
      operationId: OWN_OPERATION,
      verdict: 'passed',
    });

    expect(modelMocks.upsertByCheckItem).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'passed', verdict: 'passed' }),
    );
  });

  it("refuses evidence on a check result from another operation's round", async () => {
    modelMocks.findResultById.mockResolvedValueOnce({
      id: 'result-other',
      userId: USER_ID,
      verifyRunId: 'run-other',
    });
    modelMocks.findRunById.mockResolvedValueOnce(otherRun);

    await expect(
      createOperationCaller().uploadEvidence({
        checkResultId: 'result-other',
        content: 'note',
        type: 'text',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(modelMocks.createEvidence).not.toHaveBeenCalled();
  });

  it('attaches evidence to a check result in its own round', async () => {
    modelMocks.findResultById.mockResolvedValueOnce({
      id: 'result-own',
      userId: USER_ID,
      verifyRunId: 'run-own',
    });
    modelMocks.findRunById.mockResolvedValueOnce(ownRun);
    modelMocks.createEvidence.mockResolvedValueOnce({ id: 'evidence-1' });

    await createOperationCaller().uploadEvidence({
      checkResultId: 'result-own',
      content: 'note',
      type: 'text',
    });

    expect(modelMocks.createEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ checkResultId: 'result-own' }),
    );
  });

  it("reads only its own round's state, results and run", async () => {
    modelMocks.getStateByOperation.mockResolvedValueOnce({ verifyRunId: 'run-own' });
    await expect(
      createOperationCaller().getVerifyState({ operationId: OWN_OPERATION }),
    ).resolves.toEqual({ verifyRunId: 'run-own' });

    await expect(
      createOperationCaller().getVerifyState({ operationId: 'op_other' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      createOperationCaller().listResults({ operationId: 'op_other' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    modelMocks.findRunById.mockResolvedValueOnce(otherRun);
    await expect(
      createOperationCaller().getRun({ verifyRunId: '00000000-0000-4000-8000-000000000001' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(modelMocks.getStateByOperation).toHaveBeenCalledTimes(1);
  });

  describe('a later run in the same topic, with no round of its own', () => {
    const FOLLOW_UP = 'op_follow_up';
    // The round the topic's first run started; the follow-up run (resumed with
    // the user's feedback) inherits it.
    const topicRun = { id: 'run-topic', operationId: 'op_first', plan: [], userId: USER_ID };
    const createFollowUpCaller = () =>
      verifyRouter.createCaller({ heteroOperationScope: FOLLOW_UP, userId: USER_ID } as any);

    beforeEach(() => {
      modelMocks.findRoundForOperation.mockImplementation(async (operationId: string) =>
        operationId === FOLLOW_UP ? topicRun : undefined,
      );
    });

    /** Regression (T-730): `result submit --operation <follow-up>` failed with "No verification run for this operation". */
    it('files evidence into the inherited topic round', async () => {
      modelMocks.upsertByCheckItem.mockResolvedValueOnce({
        id: 'result-1',
        verifyRunId: 'run-topic',
      });

      await createFollowUpCaller().submitCheckEvidence({
        checkItemId: 'item-1',
        operationId: FOLLOW_UP,
        toulmin: { evidence: 'Fixed after feedback.' },
      });

      expect(modelMocks.upsertByCheckItem).toHaveBeenCalledWith(
        expect.objectContaining({ checkItemId: 'item-1', verifyRunId: 'run-topic' }),
      );
    });

    it('disputes a check of the inherited topic round', async () => {
      await createFollowUpCaller()
        .disputeCheck({
          checkItemId: 'item-1',
          kind: 'invalid_criterion',
          operationId: FOLLOW_UP,
          reason: 'Out of scope',
        })
        .catch((error) => expect(error).not.toMatchObject({ code: 'FORBIDDEN' }));
      expect(modelMocks.findRoundForOperation).toHaveBeenCalledWith(FOLLOW_UP);
    });

    /** Regression (T-730): `plan state <follow-up>` returned null, so the run never saw its checkItemIds. */
    it('reads the inherited round state and results by default', async () => {
      modelMocks.getStateByOperation.mockResolvedValueOnce({ verifyRunId: 'run-topic' });
      await expect(
        createFollowUpCaller().getVerifyState({ operationId: FOLLOW_UP }),
      ).resolves.toEqual({ verifyRunId: 'run-topic' });
      expect(modelMocks.getStateByOperation).toHaveBeenCalledWith(FOLLOW_UP, { inherit: true });

      modelMocks.listResultsByRun.mockResolvedValueOnce([{ checkItemId: 'item-1' }]);
      await expect(createFollowUpCaller().listResults({ operationId: FOLLOW_UP })).resolves.toEqual(
        [{ checkItemId: 'item-1' }],
      );
      expect(modelMocks.listResultsByRun).toHaveBeenCalledWith('run-topic');
    });

    it('reaches the inherited round by id, and no other', async () => {
      modelMocks.findRunById.mockResolvedValueOnce(topicRun);
      await expect(
        createFollowUpCaller().getRun({ verifyRunId: '00000000-0000-4000-8000-000000000002' }),
      ).resolves.toEqual(topicRun);

      modelMocks.findRunById.mockResolvedValueOnce(otherRun);
      await expect(
        createFollowUpCaller().getRun({ verifyRunId: '00000000-0000-4000-8000-000000000001' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      modelMocks.findRunById.mockResolvedValueOnce(otherRun);
      await expect(
        createFollowUpCaller().submitCheckEvidence({
          checkItemId: 'item-1',
          verifyRunId: 'run-other',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(modelMocks.upsertByCheckItem).not.toHaveBeenCalled();
    });
  });

  it("keeps a user session on the operation's own round unless it asks to inherit", async () => {
    modelMocks.getStateByOperation.mockResolvedValue(null);
    const caller = verifyRouter.createCaller({ userId: USER_ID } as any);

    await caller.getVerifyState({ operationId: 'op_any' });
    expect(modelMocks.getStateByOperation).toHaveBeenLastCalledWith('op_any', { inherit: false });

    await caller.getVerifyState({ inherit: true, operationId: 'op_any' });
    expect(modelMocks.getStateByOperation).toHaveBeenLastCalledWith('op_any', { inherit: true });
  });

  it('leaves a user session unbound', async () => {
    modelMocks.getStateByOperation.mockResolvedValueOnce({ verifyRunId: 'run-other' });

    await expect(
      verifyRouter
        .createCaller({ userId: USER_ID } as any)
        .getVerifyState({ operationId: 'op_other' }),
    ).resolves.toEqual({ verifyRunId: 'run-other' });
  });
});
