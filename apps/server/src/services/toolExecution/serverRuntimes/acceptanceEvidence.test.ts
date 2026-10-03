// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { acceptanceEvidenceRuntime } from './acceptanceEvidence';

const mocks = vi.hoisted(() => ({
  attachPolicyRun: vi.fn(),
  documentFindByIds: vi.fn(),
  evidenceCreateMany: vi.fn(),
  evidenceListByRun: vi.fn(),
  fileFindById: vi.fn(),
  operationFindById: vi.fn(),
  resolveTaskAcceptance: vi.fn(),
  resultUpsert: vi.fn(),
  runConfirmPlan: vi.fn(),
  runEnsureForOperation: vi.fn(),
  runFindByOperation: vi.fn(),
  runSetPlan: vi.fn(),
}));

vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: vi.fn(function () {
    return { findById: mocks.operationFindById };
  }),
}));
vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(function () {
    return { findByIds: mocks.documentFindByIds };
  }),
}));
vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(function () {
    return { findById: mocks.fileFindById };
  }),
}));
vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(function () {
    return { upsertByCheckItem: mocks.resultUpsert };
  }),
}));
vi.mock('@/database/models/verifyEvidence', () => ({
  VerifyEvidenceModel: vi.fn(function () {
    return {
      createMany: mocks.evidenceCreateMany,
      listByRun: mocks.evidenceListByRun,
    };
  }),
}));
vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(function () {
    return {
      confirmPlan: mocks.runConfirmPlan,
      ensureForOperation: mocks.runEnsureForOperation,
      findByOperation: mocks.runFindByOperation,
      setPlan: mocks.runSetPlan,
    };
  }),
}));
vi.mock('@/server/services/verify/acceptanceService', () => ({
  AcceptanceService: vi.fn(function () {
    return { attachPolicyRun: mocks.attachPolicyRun };
  }),
}));
vi.mock('@/server/services/verify/taskAcceptance', () => ({
  resolveTaskAcceptance: mocks.resolveTaskAcceptance,
}));

describe('acceptanceEvidenceRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.operationFindById.mockResolvedValue({
      id: 'evidence-op',
      parentOperationId: 'parent-op',
    });
    mocks.runFindByOperation.mockImplementation(async (operationId) =>
      operationId === 'evidence-op'
        ? null
        : {
            id: 'run-1',
            plan: [
              {
                id: 'criterion-1',
                index: 0,
                required: true,
                title: 'Document',
                verifierType: 'llm',
              },
            ],
          },
    );
    mocks.resultUpsert.mockResolvedValue({ id: 'result-1' });
    mocks.evidenceCreateMany.mockResolvedValue([]);
    mocks.evidenceListByRun.mockResolvedValue([]);
    mocks.runEnsureForOperation.mockResolvedValue({ id: 'authored-run', plan: [] });
    mocks.resolveTaskAcceptance.mockResolvedValue(undefined);
  });

  const runtimeFor = (operationId: string) =>
    acceptanceEvidenceRuntime.factory({
      operationId,
      serverDB: {} as never,
      toolManifestMap: {},
      userId: 'user-1',
    });

  it('records a documents.id reference as first-class evidence', async () => {
    mocks.documentFindByIds.mockResolvedValue([{ id: 'docs_123' }]);
    const runtime = acceptanceEvidenceRuntime.factory({
      operationId: 'evidence-op',
      serverDB: {} as never,
      toolManifestMap: {},
      userId: 'user-1',
    });

    const result = await runtime.submitEvidence({
      checkItemId: 'criterion-1',
      evidence: [{ documentId: 'docs_123', type: 'markdown' }],
    });

    expect(result.success).toBe(true);
    expect(mocks.evidenceCreateMany).toHaveBeenCalledWith([
      expect.objectContaining({ documentId: 'docs_123', fileId: null }),
    ]);
  });

  it('rejects an agent-document binding id instead of inserting it as a file', async () => {
    mocks.documentFindByIds.mockResolvedValue([]);
    const runtime = acceptanceEvidenceRuntime.factory({
      operationId: 'evidence-op',
      serverDB: {} as never,
      toolManifestMap: {},
      userId: 'user-1',
    });

    const result = await runtime.submitEvidence({
      checkItemId: 'criterion-1',
      evidence: [{ documentId: 'agent-document-binding-uuid', type: 'markdown' }],
    });

    expect(result).toEqual(expect.objectContaining({ error: 'UNKNOWN_DOCUMENT', success: false }));
    expect(mocks.resultUpsert).not.toHaveBeenCalled();
    expect(mocks.evidenceCreateMany).not.toHaveBeenCalled();
  });

  it('submits against its own run when the builder captures evidence inside the main Task', async () => {
    // A main Task run has no parentOperationId. Resolving only the parent made
    // every in-run submit fail NO_PARENT_OPERATION, which is why the Acceptance
    // could only ever be evidenced by the text-only post-run turn.
    mocks.operationFindById.mockResolvedValue({ id: 'task-op', parentOperationId: null });
    mocks.fileFindById.mockResolvedValue({ id: 'files_shot' });
    const runtime = acceptanceEvidenceRuntime.factory({
      operationId: 'task-op',
      serverDB: {} as never,
      toolManifestMap: {},
      userId: 'user-1',
    });

    const result = await runtime.submitEvidence({
      checkItemId: 'criterion-1',
      evidence: [{ fileId: 'files_shot', type: 'screenshot' }],
    });

    expect(result.success).toBe(true);
    expect(mocks.runFindByOperation).toHaveBeenCalledWith('task-op');
    expect(mocks.resultUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: 'task-op' }),
    );
  });

  it('submits repair evidence into the repair round instead of its failed parent', async () => {
    mocks.operationFindById.mockResolvedValue({ id: 'repair-op', parentOperationId: 'parent-op' });
    mocks.runFindByOperation.mockImplementation(async (id) => ({
      id: id === 'repair-op' ? 'repair-run' : 'parent-run',
      plan: [
        { id: 'criterion-1', index: 0, required: true, title: 'Document', verifierType: 'llm' },
      ],
    }));
    const runtime = acceptanceEvidenceRuntime.factory({
      operationId: 'repair-op',
      serverDB: {} as never,
      toolManifestMap: {},
      userId: 'user-1',
    });
    expect(
      (
        await runtime.submitEvidence({
          checkItemId: 'criterion-1',
          evidence: [{ content: 'corrected output', type: 'text' }],
        })
      ).success,
    ).toBe(true);
    expect(mocks.resultUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: 'repair-op', verifyRunId: 'repair-run' }),
    );
    expect(mocks.runFindByOperation).not.toHaveBeenCalledWith('parent-op');
  });

  it('keeps writing into the parent run from the post-run evidence turn', async () => {
    const runtime = acceptanceEvidenceRuntime.factory({
      operationId: 'evidence-op',
      serverDB: {} as never,
      toolManifestMap: {},
      userId: 'user-1',
    });

    const result = await runtime.submitEvidence({
      checkItemId: 'criterion-1',
      evidence: [{ content: 'raw output', type: 'text' }],
    });

    expect(result.success).toBe(true);
    expect(mocks.runFindByOperation).toHaveBeenCalledWith('parent-op');
  });

  it('lists the run criteria with the evidence already captured for each', async () => {
    mocks.operationFindById.mockResolvedValue({ id: 'task-op', parentOperationId: null });
    mocks.runFindByOperation.mockResolvedValue({
      id: 'run-1',
      plan: [
        {
          id: 'criterion-1',
          index: 0,
          required: true,
          title: 'Document',
          verifierConfig: { requiredEvidence: [{ hint: 'full page', type: 'screenshot' }] },
          verifierType: 'llm',
        },
        { id: 'criterion-2', index: 1, required: false, title: 'Clean', verifierType: 'llm' },
      ],
    });
    mocks.evidenceListByRun.mockResolvedValue([
      { checkItemId: 'criterion-1' },
      { checkItemId: 'criterion-1' },
    ]);

    const runtime = acceptanceEvidenceRuntime.factory({
      operationId: 'task-op',
      serverDB: {} as never,
      toolManifestMap: {},
      userId: 'user-1',
    });

    const result = await runtime.listCriteria();

    expect(result).toEqual(
      expect.objectContaining({
        criteria: [
          {
            id: 'criterion-1',
            index: 0,
            required: true,
            requiredEvidence: [{ hint: 'full page', type: 'screenshot' }],
            submittedEvidence: 2,
            title: 'Document',
          },
          {
            id: 'criterion-2',
            index: 1,
            required: false,
            submittedEvidence: 0,
            title: 'Clean',
          },
        ],
        success: true,
      }),
    );
  });

  it('treats padded empty-string ids as absent instead of failing the lookup', async () => {
    // A live builder run submitted { content, documentId: '', fileId: '' } nine
    // times and every call was rejected as UNKNOWN_FILE, so the acceptance
    // ended with zero evidence. Empty strings are absent, not references.
    mocks.operationFindById.mockResolvedValue({ id: 'task-op', parentOperationId: null });
    const runtime = acceptanceEvidenceRuntime.factory({
      operationId: 'task-op',
      serverDB: {} as never,
      toolManifestMap: {},
      userId: 'user-1',
    });

    const result = await runtime.submitEvidence({
      checkItemId: 'criterion-1',
      evidence: [{ content: 'raw output', documentId: '', fileId: '', type: 'markdown' }],
    });

    expect(result.success).toBe(true);
    expect(mocks.fileFindById).not.toHaveBeenCalled();
    expect(mocks.documentFindByIds).not.toHaveBeenCalled();
    expect(mocks.evidenceCreateMany).toHaveBeenCalledWith([
      expect.objectContaining({ content: 'raw output', documentId: null, fileId: null }),
    ]);
  });

  it('returns readable content so the model does not see a synthetic tool failure', async () => {
    // A tool result with no readable `content` is replaced downstream by
    // `{"error":"Tool call failed"}`, which made a live builder abandon the
    // plan-driven path on its first call.
    mocks.operationFindById.mockResolvedValue({ id: 'task-op', parentOperationId: null });
    const runtime = acceptanceEvidenceRuntime.factory({
      operationId: 'task-op',
      serverDB: {} as never,
      toolManifestMap: {},
      userId: 'user-1',
    });

    const result = await runtime.listCriteria();

    expect(typeof result.content).toBe('string');
    expect(result.content).toContain('criterion-1');
    expect(result.content).toContain('Document');
  });

  it('accepts a caption alongside a cited artifact', async () => {
    // A live builder that had captured a screenshot AND wanted to describe it
    // was rejected, dropped the fileId, and resubmitted prose with the id
    // written into the text — the text-only outcome this path exists to prevent.
    mocks.operationFindById.mockResolvedValue({ id: 'task-op', parentOperationId: null });
    mocks.fileFindById.mockResolvedValue({ id: 'files_shot' });
    const runtime = acceptanceEvidenceRuntime.factory({
      operationId: 'task-op',
      serverDB: {} as never,
      toolManifestMap: {},
      userId: 'user-1',
    });

    const result = await runtime.submitEvidence({
      checkItemId: 'criterion-1',
      evidence: [
        { content: 'The sign-in page rendered', fileId: 'files_shot', type: 'screenshot' },
      ],
    });

    expect(result.success).toBe(true);
    expect(mocks.evidenceCreateMany).toHaveBeenCalledWith([
      expect.objectContaining({ content: 'The sign-in page rendered', fileId: 'files_shot' }),
    ]);
  });

  it('rejects an item that references both a document and a file', async () => {
    mocks.operationFindById.mockResolvedValue({ id: 'task-op', parentOperationId: null });
    const runtime = acceptanceEvidenceRuntime.factory({
      operationId: 'task-op',
      serverDB: {} as never,
      toolManifestMap: {},
      userId: 'user-1',
    });

    const result = await runtime.submitEvidence({
      checkItemId: 'criterion-1',
      evidence: [{ documentId: 'docs_1', fileId: 'files_1', type: 'markdown' }],
    });

    expect(result).toEqual(expect.objectContaining({ error: 'INVALID_EVIDENCE', success: false }));
  });

  it('waits for a plan that the fire-and-forget run-start instantiation has not landed yet', async () => {
    // Answering NO_ACCEPTANCE_PLAN to a builder that asks what to prove as its
    // first move reads as "this Task has no Acceptance", and the run then ends
    // with no evidence at all.
    mocks.operationFindById.mockResolvedValue({ id: 'task-op', parentOperationId: null });
    mocks.runFindByOperation
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: 'run-1', plan: [] })
      .mockResolvedValue({
        id: 'run-1',
        plan: [{ id: 'criterion-1', index: 0, required: true, title: 'Late', verifierType: 'llm' }],
      });

    const runtime = acceptanceEvidenceRuntime.factory({
      operationId: 'task-op',
      serverDB: {} as never,
      toolManifestMap: {},
      userId: 'user-1',
    });

    const result = await runtime.listCriteria();

    expect(result.success).toBe(true);
    expect(result.criteria).toHaveLength(1);
    expect(mocks.runFindByOperation.mock.calls.length).toBeGreaterThan(2);
  });

  it('rejects a visual type that has no artifact behind it', async () => {
    // A live builder submitted { type: 'screenshot', content: '…(see the
    // screenshot file)' } with no file, which would render on the acceptance
    // as a visual check with nothing to open.
    mocks.operationFindById.mockResolvedValue({ id: 'task-op', parentOperationId: null });
    const runtime = acceptanceEvidenceRuntime.factory({
      operationId: 'task-op',
      serverDB: {} as never,
      toolManifestMap: {},
      userId: 'user-1',
    });

    const result = await runtime.submitEvidence({
      checkItemId: 'criterion-1',
      evidence: [{ content: 'I opened the page and captured it', fileId: '', type: 'screenshot' }],
    });

    expect(result).toEqual(
      expect.objectContaining({ error: 'UNBACKED_VISUAL_EVIDENCE', success: false }),
    );
    expect(mocks.evidenceCreateMany).not.toHaveBeenCalled();
  });

  it('rejects an unknown files.id before the evidence foreign key is evaluated', async () => {
    mocks.fileFindById.mockResolvedValue(undefined);
    const runtime = acceptanceEvidenceRuntime.factory({
      operationId: 'evidence-op',
      serverDB: {} as never,
      toolManifestMap: {},
      userId: 'user-1',
    });

    const result = await runtime.submitEvidence({
      checkItemId: 'criterion-1',
      evidence: [{ fileId: 'agent-document-binding-uuid', type: 'markdown' }],
    });

    expect(result).toEqual(expect.objectContaining({ error: 'UNKNOWN_FILE', success: false }));
    expect(mocks.evidenceCreateMany).not.toHaveBeenCalled();
  });

  /**
   * The run-start plan is minted fire-and-forget and its failure is swallowed
   * (verify must never break a run), so a builder can land on an operation with no
   * session at all. That used to be a dead end: no criteria to read and nowhere to
   * put evidence, so the delivery's Acceptance stayed `pending` with zero rounds.
   * The standard Acceptance flow authors the checklist when none exists; this is
   * the in-Task arm of that.
   */
  it('authors the checklist for a run that has none, and binds it to the task acceptance', async () => {
    mocks.operationFindById.mockResolvedValue({
      id: 'task-op',
      parentOperationId: null,
      taskId: 'task-1',
    });
    mocks.runFindByOperation.mockResolvedValue(null);
    mocks.resolveTaskAcceptance.mockResolvedValue({ acceptance: { id: 'acc-1' } });

    const result = await runtimeFor('task-op').authorCriteria({
      items: [
        { description: 'Two PRs, merged separately', title: 'Each transport package ships alone' },
        { title: 'The identity branch rebases onto canary without conflicts' },
      ],
    });

    expect(result.success).toBe(true);
    expect(mocks.runSetPlan).toHaveBeenCalledWith('authored-run', [
      expect.objectContaining({
        index: 0,
        required: true,
        title: 'Each transport package ships alone',
        verifierType: 'agent',
      }),
      expect.objectContaining({ index: 1, required: true }),
    ]);
    expect(mocks.runConfirmPlan).toHaveBeenCalledWith('authored-run');
    expect(mocks.attachPolicyRun).toHaveBeenCalledWith('authored-run', 'acc-1');
    // The ids come back in the answer, so the builder can start evidencing
    // without a second round-trip.
    expect(result.criteria).toHaveLength(2);
    expect(result.content).toContain('Each transport package ships alone');
  });

  it('evidences a self-authored criterion', async () => {
    mocks.operationFindById.mockResolvedValue({ id: 'task-op', parentOperationId: null });
    mocks.runFindByOperation.mockResolvedValue(null);
    const runtime = runtimeFor('task-op');

    const signedOff = await runtime.authorCriteria({ items: [{ title: 'PRs are separate' }] });
    const plan = mocks.runSetPlan.mock.calls[0][1];
    mocks.runFindByOperation.mockResolvedValue({ id: 'authored-run', plan });

    const submitted = await runtime.submitEvidence({
      checkItemId: plan[0].id,
      evidence: [{ content: 'PR #20271 and PR #20272, merged separately', type: 'text' }],
    });

    expect(signedOff.success).toBe(true);
    expect(submitted.success).toBe(true);
    expect(mocks.resultUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        checkItemId: plan[0].id,
        checkItemTitle: 'PRs are separate',
        verifyRunId: 'authored-run',
      }),
    );
  });

  it('keeps the checklist a run already has instead of authoring a second one', async () => {
    const existing = [
      { id: 'criterion-1', index: 0, required: true, title: 'Document', verifierType: 'llm' },
    ];
    mocks.operationFindById.mockResolvedValue({ id: 'task-op', parentOperationId: null });
    mocks.runFindByOperation.mockResolvedValue({ id: 'run-1', plan: existing });
    mocks.runEnsureForOperation.mockResolvedValue({ id: 'run-1', plan: existing });

    const result = await runtimeFor('task-op').authorCriteria({ items: [{ title: 'Mine' }] });

    expect(result).toEqual(
      expect.objectContaining({ error: 'PLAN_ALREADY_EXISTS', success: false }),
    );
    expect(result.content).toContain('criterion-1');
    expect(mocks.runSetPlan).not.toHaveBeenCalled();
  });

  it('refuses to author over a plan that is already frozen', async () => {
    mocks.operationFindById.mockResolvedValue({ id: 'task-op', parentOperationId: null });
    mocks.runFindByOperation.mockResolvedValue(null);
    // `setPlan` refuses a confirmed round rather than overwriting its checklist.
    mocks.runSetPlan.mockRejectedValue(new Error('Draft verification round required'));

    const result = await runtimeFor('task-op').authorCriteria({ items: [{ title: 'Mine' }] });

    expect(result).toEqual(expect.objectContaining({ error: 'PLAN_NOT_WRITABLE', success: false }));
    expect(mocks.runConfirmPlan).not.toHaveBeenCalled();
  });

  it('needs at least one titled item to author a checklist', async () => {
    mocks.operationFindById.mockResolvedValue({ id: 'task-op', parentOperationId: null });
    mocks.runFindByOperation.mockResolvedValue(null);

    const result = await runtimeFor('task-op').authorCriteria({ items: [{ title: '   ' }] });

    expect(result).toEqual(expect.objectContaining({ error: 'INVALID_ARGUMENTS', success: false }));
    expect(mocks.runSetPlan).not.toHaveBeenCalled();
  });

  it('names the way out when a submit arrives before any criteria exist', async () => {
    mocks.operationFindById.mockResolvedValue({ id: 'task-op', parentOperationId: null });
    mocks.runFindByOperation.mockResolvedValue({ id: 'run-1', plan: [] });

    const result = await runtimeFor('task-op').submitEvidence({
      checkItemId: 'criterion-x',
      evidence: [{ content: 'observed', type: 'text' }],
    });

    expect(result).toEqual(
      expect.objectContaining({
        canAuthor: true,
        error: 'UNKNOWN_CRITERION',
        success: false,
      }),
    );
    expect(result.content).toContain('authorCriteria');
  });

  it('reports why the run-start plan never landed, and how to recover', async () => {
    mocks.operationFindById.mockResolvedValue({
      id: 'task-op',
      metadata: { verifyPlanError: 'provider unreachable' },
      parentOperationId: null,
    });
    mocks.runFindByOperation.mockResolvedValue(null);

    const result = await runtimeFor('task-op').listCriteria();

    expect(result).toEqual(
      expect.objectContaining({
        canAuthor: true,
        error: 'NO_ACCEPTANCE_PLAN',
        success: false,
      }),
    );
    expect(result.content).toContain('authorCriteria');
    expect(result.content).toContain('provider unreachable');
  });
});
