import { SpanStatusCode } from '@lobechat/observability-otel/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SelfReviewProposalBaseSnapshot } from '../../review/proposal';

const { spanEnd, spanRecordException, spanSetAttribute, spanSetStatus, startActiveSpan } =
  vi.hoisted(() => {
    interface MockSpan {
      end: ReturnType<typeof vi.fn>;
      recordException: ReturnType<typeof vi.fn>;
      setAttribute: ReturnType<typeof vi.fn>;
      setStatus: ReturnType<typeof vi.fn>;
    }

    const spanSetAttribute = vi.fn();
    const spanSetStatus = vi.fn();
    const spanRecordException = vi.fn();
    const spanEnd = vi.fn();
    const startActiveSpan = vi.fn(
      async (_name: string, _options: unknown, callback: (span: MockSpan) => unknown) => {
        return callback({
          end: spanEnd,
          recordException: spanRecordException,
          setAttribute: spanSetAttribute,
          setStatus: spanSetStatus,
        });
      },
    );

    return { spanEnd, spanRecordException, spanSetAttribute, spanSetStatus, startActiveSpan };
  });

vi.mock('@lobechat/observability-otel/modules/agent-signal', () => ({
  tracer: { startActiveSpan },
}));

const refineSkillBaseSnapshot = {
  agentDocumentId: 'skill-1',
  contentHash: 'hash-before',
  documentId: 'document-1',
  managed: true,
  targetType: 'skill',
  writable: true,
} satisfies SelfReviewProposalBaseSnapshot;

describe('createToolSet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * @example
   * await tools.replaceSkillContentCAS({ baseRevision: 'old' });
   * expect(result.status).toBe('skipped_stale');
   */
  it('replaceSkillContentCAS returns skipped_stale without writing when preflight fails', async () => {
    const { createToolSet } = await import('../shared');
    const replaceSkill = vi.fn();
    const writeReceipt = vi.fn().mockResolvedValue({ receiptId: 'receipt-stale' });
    const tools = createToolSet({
      preflight: vi.fn().mockResolvedValue({ allowed: false, reason: 'Document changed.' }),
      replaceSkill,
      reserveOperation: vi.fn().mockResolvedValue({ reserved: true }),
      writeReceipt,
    });

    const result = await tools.replaceSkillContentCAS({
      baseSnapshot: refineSkillBaseSnapshot,
      bodyMarkdown: 'Updated body',
      idempotencyKey: 'op-replace-1',
      proposalKey: 'proposal-skill-1',
      skillDocumentId: 'skill-1',
      summary: 'Document changed. '.repeat(30),
      userId: 'user-1',
    });

    expect(replaceSkill).not.toHaveBeenCalled();
    expect(result).toEqual({
      receiptId: 'receipt-stale',
      resourceId: 'skill-1',
      status: 'skipped_stale',
      summary: expect.stringMatching(/^Document changed\./),
    });
    expect(result.summary?.length).toBeLessThanOrEqual(240);
    expect(writeReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'op-replace-1',
        proposalKey: 'proposal-skill-1',
        status: 'skipped_stale',
      }),
    );
  });

  /**
   * @example
   * await tools.replaceSkillContentCAS({ idempotencyKey: 'same-key' });
   * returns the existing receipt without calling preflight or replaceSkill.
   */
  it('replaceSkillContentCAS dedupes existing reserved idempotency keys', async () => {
    const { createToolSet } = await import('../shared');
    const preflight = vi.fn();
    const replaceSkill = vi.fn();
    const writeReceipt = vi.fn().mockResolvedValue({ receiptId: 'receipt-deduped' });
    const tools = createToolSet({
      preflight,
      replaceSkill,
      reserveOperation: vi.fn().mockResolvedValue({
        existing: {
          receiptId: 'receipt-existing',
          resourceId: 'skill-1',
          status: 'applied',
          summary: 'Already replaced.',
        },
        reserved: false,
      }),
      writeReceipt,
    });

    const result = await tools.replaceSkillContentCAS({
      baseSnapshot: refineSkillBaseSnapshot,
      bodyMarkdown: 'Updated body',
      idempotencyKey: 'op-replace-1',
      proposalKey: 'proposal-skill-1',
      skillDocumentId: 'skill-1',
      userId: 'user-1',
    });

    expect(preflight).not.toHaveBeenCalled();
    expect(replaceSkill).not.toHaveBeenCalled();
    expect(result).toEqual({
      receiptId: 'receipt-deduped',
      resourceId: 'skill-1',
      status: 'deduped',
      summary: 'Already replaced.',
    });
    expect(writeReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'op-replace-1',
        status: 'deduped',
      }),
    );
  });

  /**
   * @example
   * await tools.createSelfReviewProposal({ proposalKey: 'p1' });
   * expect(result.status).toBe('proposed');
   */
  it('createSelfReviewProposal returns proposed and writes a receipt', async () => {
    const { createToolSet } = await import('../shared');
    const createProposal = vi.fn().mockResolvedValue({
      proposalId: 'proposal-1',
      summary: 'Proposal created.',
    });
    const writeReceipt = vi.fn().mockResolvedValue({ receiptId: 'receipt-proposed' });
    const tools = createToolSet({
      createProposal,
      reserveOperation: vi.fn().mockResolvedValue({ reserved: true }),
      writeReceipt,
    });

    const result = await tools.createSelfReviewProposal({
      idempotencyKey: 'op-proposal-1',
      proposalKey: 'proposal-skill-1',
      summary: 'Create proposal.',
      userId: 'user-1',
    });

    expect(createProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'op-proposal-1',
        proposalKey: 'proposal-skill-1',
      }),
    );
    expect(result).toEqual({
      receiptId: 'receipt-proposed',
      resourceId: 'proposal-1',
      status: 'proposed',
      summary: 'Proposal created.',
    });
    expect(writeReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'op-proposal-1',
        proposalKey: 'proposal-skill-1',
        status: 'proposed',
      }),
    );
    expect(startActiveSpan).toHaveBeenCalledWith(
      'agent_signal.self_iteration_tool.write',
      expect.objectContaining({
        attributes: expect.objectContaining({
          'agent.signal.self_iteration_tool.name': 'createSelfReviewProposal',
          'agent.signal.proposal.key': 'proposal-skill-1',
        }),
      }),
      expect.any(Function),
    );
    expect(spanSetAttribute).toHaveBeenCalledWith(
      'agent.signal.self_iteration_tool.write_status',
      'proposed',
    );
    expect(spanEnd).toHaveBeenCalled();
  });

  /**
   * @example
   * await tools.createSkillIfAbsent({ idempotencyKey: 'op-create-skill' });
   * expect(result.status).toBe('failed');
   */
  it('createSkillIfAbsent returns failed and writes a failed receipt when mutation throws', async () => {
    const { createToolSet } = await import('../shared');
    const error = new Error('Skill write failed.');
    const writeReceipt = vi.fn().mockResolvedValue({ receiptId: 'receipt-failed' });
    const tools = createToolSet({
      createSkill: vi.fn().mockRejectedValue(error),
      reserveOperation: vi.fn().mockResolvedValue({ reserved: true }),
      writeReceipt,
    });

    const result = await tools.createSkillIfAbsent({
      bodyMarkdown: 'Skill body',
      idempotencyKey: 'op-create-skill-1',
      name: 'skill-name',
      userId: 'user-1',
    });

    expect(result).toEqual({
      receiptId: 'receipt-failed',
      status: 'failed',
      summary: 'Skill write failed.',
    });
    expect(writeReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'op-create-skill-1',
        status: 'failed',
        summary: 'Skill write failed.',
      }),
    );
    expect(spanRecordException).toHaveBeenCalledWith(error);
    expect(spanSetStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR });
    expect(spanEnd).toHaveBeenCalled();
  });

  /**
   * @example
   * await tools.createSelfReviewProposal({ idempotencyKey: 'op-receipt-fails' });
   * rejects when the terminal receipt cannot be written.
   */
  it('createSelfReviewProposal propagates receipt failures and records the write span exception', async () => {
    const { createToolSet } = await import('../shared');
    const error = new Error('Receipt write failed.');
    const markOperationFailed = vi.fn().mockResolvedValue(undefined);
    const tools = createToolSet({
      createProposal: vi.fn().mockResolvedValue({
        proposalId: 'proposal-1',
        summary: 'Proposal created.',
      }),
      markOperationFailed,
      reserveOperation: vi.fn().mockResolvedValue({ reserved: true }),
      writeReceipt: vi.fn().mockRejectedValue(error),
    });

    await expect(
      tools.createSelfReviewProposal({
        idempotencyKey: 'op-receipt-fails-1',
        proposalKey: 'proposal-skill-1',
        userId: 'user-1',
      }),
    ).rejects.toThrow('Receipt write failed.');

    expect(spanRecordException).toHaveBeenCalledWith(error);
    expect(markOperationFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        error,
        idempotencyKey: 'op-receipt-fails-1',
        proposalKey: 'proposal-skill-1',
        resourceId: 'proposal-1',
        status: 'proposed',
        toolName: 'createSelfReviewProposal',
        userId: 'user-1',
      }),
    );
    expect(spanSetStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: 'Receipt write failed.',
    });
    expect(spanEnd).toHaveBeenCalled();
  });

  /**
   * @example
   * await tools.replaceSkillContentCAS({ skillDocumentId: 'skill-1' });
   * returns the known skill id when the adapter only returns a summary.
   */
  it('replaceSkillContentCAS keeps the known resource id when replacement omits it', async () => {
    const { createToolSet } = await import('../shared');
    const writeReceipt = vi.fn().mockResolvedValue({ receiptId: 'receipt-replace' });
    const tools = createToolSet({
      preflight: vi.fn().mockResolvedValue({ allowed: true }),
      replaceSkill: vi.fn().mockResolvedValue({ summary: 'Skill replaced.' }),
      reserveOperation: vi.fn().mockResolvedValue({ reserved: true }),
      writeReceipt,
    });

    const result = await tools.replaceSkillContentCAS({
      baseSnapshot: refineSkillBaseSnapshot,
      bodyMarkdown: 'Updated body',
      idempotencyKey: 'op-replace-success-1',
      proposalKey: 'proposal-skill-1',
      skillDocumentId: 'skill-1',
      userId: 'user-1',
    });

    expect(result).toEqual({
      receiptId: 'receipt-replace',
      resourceId: 'skill-1',
      status: 'applied',
      summary: 'Skill replaced.',
    });
    expect(writeReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: 'skill-1',
        status: 'applied',
      }),
    );
  });

  /**
   * @example
   * await tools.replaceSkillContentCAS({ patchMarkdown: 'diff only' });
   * skips unsupported refine payloads before calling replaceSkill.
   */
  it('rejects patch-only refine payload before mutation with skipped_unsupported and receipt', async () => {
    const { createToolSet } = await import('../shared');
    const preflight = vi.fn().mockResolvedValue({ allowed: true });
    const replaceSkill = vi.fn();
    const reserveOperation = vi.fn().mockResolvedValue({ reserved: true });
    const writeReceipt = vi.fn().mockResolvedValue({ receiptId: 'receipt-invalid-refine' });
    const tools = createToolSet({
      preflight,
      replaceSkill,
      reserveOperation,
      writeReceipt,
    });
    const patchOnlyInput = {
      baseSnapshot: refineSkillBaseSnapshot,
      idempotencyKey: 'op-invalid-refine-1',
      patchMarkdown: '--- old\n+++ new',
      skillDocumentId: 'skill-1',
      userId: 'user-1',
    } as unknown as Parameters<typeof tools.replaceSkillContentCAS>[0];

    const result = await tools.replaceSkillContentCAS(patchOnlyInput);

    expect(preflight).not.toHaveBeenCalled();
    expect(replaceSkill).not.toHaveBeenCalled();
    expect(result).toEqual({
      receiptId: 'receipt-invalid-refine',
      resourceId: 'skill-1',
      status: 'skipped_unsupported',
      summary: 'Skill replacement requires a non-empty body.',
    });
    expect(writeReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'op-invalid-refine-1',
        status: 'skipped_unsupported',
      }),
    );
    expect(reserveOperation).toHaveBeenCalledWith('op-invalid-refine-1');
  });

  /**
   * @example
   * await tools.replaceSkillContentCAS({ bodyMarkdown: 'Updated body' });
   * skips unsupported refine payloads without a complete base snapshot.
   */
  it('rejects missing baseSnapshot refine payload before mutation with skipped_unsupported and receipt', async () => {
    const { createToolSet } = await import('../shared');
    const preflight = vi.fn().mockResolvedValue({ allowed: true });
    const replaceSkill = vi.fn();
    const tools = createToolSet({
      preflight,
      replaceSkill,
      reserveOperation: vi.fn().mockResolvedValue({ reserved: true }),
      writeReceipt: vi.fn().mockResolvedValue({ receiptId: 'receipt-missing-snapshot' }),
    });
    const missingSnapshotInput = {
      bodyMarkdown: 'Updated body',
      idempotencyKey: 'op-missing-snapshot-1',
      skillDocumentId: 'skill-1',
      userId: 'user-1',
    } as unknown as Parameters<typeof tools.replaceSkillContentCAS>[0];

    const result = await tools.replaceSkillContentCAS(missingSnapshotInput);

    expect(preflight).not.toHaveBeenCalled();
    expect(replaceSkill).not.toHaveBeenCalled();
    expect(result).toEqual({
      receiptId: 'receipt-missing-snapshot',
      resourceId: 'skill-1',
      status: 'skipped_unsupported',
      summary: 'Skill replacement requires a complete base snapshot.',
    });
  });

  /**
   * @example
   * await tools.replaceSkillContentCAS({ baseSnapshot: { targetType: 'skill' } });
   * skips unsupported refine payloads with incomplete snapshots.
   */
  it('rejects incomplete baseSnapshot refine payload before mutation with skipped_unsupported and receipt', async () => {
    const { createToolSet } = await import('../shared');
    const preflight = vi.fn().mockResolvedValue({ allowed: true });
    const replaceSkill = vi.fn();
    const tools = createToolSet({
      preflight,
      replaceSkill,
      reserveOperation: vi.fn().mockResolvedValue({ reserved: true }),
      writeReceipt: vi.fn().mockResolvedValue({ receiptId: 'receipt-incomplete-snapshot' }),
    });

    const result = await tools.replaceSkillContentCAS({
      baseSnapshot: {
        agentDocumentId: 'skill-1',
        contentHash: 'hash-before',
        documentId: '',
        managed: true,
        targetType: 'skill',
        writable: true,
      },
      bodyMarkdown: 'Updated body',
      idempotencyKey: 'op-incomplete-snapshot-1',
      skillDocumentId: 'skill-1',
      userId: 'user-1',
    });

    expect(preflight).not.toHaveBeenCalled();
    expect(replaceSkill).not.toHaveBeenCalled();
    expect(result).toEqual({
      receiptId: 'receipt-incomplete-snapshot',
      resourceId: 'skill-1',
      status: 'skipped_unsupported',
      summary: 'Skill replacement requires a complete base snapshot.',
    });
  });

  /**
   * @example
   * await tools.createSkillIfAbsent({ name: '   ', bodyMarkdown: '' });
   * skips unsupported create payloads before calling createSkill.
   */
  it('rejects missing or blank create body and name before mutation with skipped_unsupported and receipt', async () => {
    const { createToolSet } = await import('../shared');
    const createSkill = vi.fn();
    const writeReceipt = vi.fn().mockResolvedValue({ receiptId: 'receipt-invalid-create' });
    const tools = createToolSet({
      createSkill,
      reserveOperation: vi.fn().mockResolvedValue({ reserved: true }),
      writeReceipt,
    });

    const missingInput = {
      idempotencyKey: 'op-invalid-create-missing-1',
      userId: 'user-1',
    } as unknown as Parameters<typeof tools.createSkillIfAbsent>[0];
    const missingResult = await tools.createSkillIfAbsent(missingInput);
    const blankResult = await tools.createSkillIfAbsent({
      bodyMarkdown: '',
      idempotencyKey: 'op-invalid-create-1',
      name: '   ',
      userId: 'user-1',
    });

    expect(createSkill).not.toHaveBeenCalled();
    expect(missingResult).toEqual({
      receiptId: 'receipt-invalid-create',
      status: 'skipped_unsupported',
      summary: 'Skill creation requires a non-empty name and body.',
    });
    expect(blankResult).toEqual({
      receiptId: 'receipt-invalid-create',
      status: 'skipped_unsupported',
      summary: 'Skill creation requires a non-empty name and body.',
    });
    expect(writeReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'op-invalid-create-1',
        status: 'skipped_unsupported',
      }),
    );
  });

  /**
   * @example
   * await tools.createSkillIfAbsent({ idempotencyKey: 'same-key' });
   * returns a deduped receipt without calling createSkill.
   */
  it('keeps dedupe behavior for valid writes', async () => {
    const { createToolSet } = await import('../shared');
    const createSkill = vi.fn();
    const writeReceipt = vi.fn().mockResolvedValue({ receiptId: 'receipt-deduped-create' });
    const tools = createToolSet({
      createSkill,
      reserveOperation: vi.fn().mockResolvedValue({
        existing: {
          resourceId: 'skill-created-1',
          status: 'applied',
          summary: 'Already created.',
        },
        reserved: false,
      }),
      writeReceipt,
    });

    const result = await tools.createSkillIfAbsent({
      bodyMarkdown: 'Skill body',
      idempotencyKey: 'op-create-dedupe-1',
      name: 'skill-name',
      userId: 'user-1',
    });

    expect(createSkill).not.toHaveBeenCalled();
    expect(result).toEqual({
      receiptId: 'receipt-deduped-create',
      resourceId: 'skill-created-1',
      status: 'deduped',
      summary: 'Already created.',
    });
  });

  /**
   * @example
   * await tools.closeSelfReviewProposal({ proposalId: 'proposal-1' });
   * expect(result.status).toBe('skipped_unsupported');
   */
  it('closeSelfReviewProposal skips unsupported when preflight is missing and does not mutate', async () => {
    const { createToolSet } = await import('../shared');
    const closeProposal = vi.fn();
    const tools = createToolSet({
      closeProposal,
      reserveOperation: vi.fn().mockResolvedValue({ reserved: true }),
      writeReceipt: vi.fn().mockResolvedValue({ receiptId: 'receipt-unsupported' }),
    });

    const result = await tools.closeSelfReviewProposal({
      idempotencyKey: 'op-close-1',
      proposalId: 'proposal-1',
      userId: 'user-1',
    });

    expect(closeProposal).not.toHaveBeenCalled();
    expect(result).toEqual({
      receiptId: 'receipt-unsupported',
      resourceId: 'proposal-1',
      status: 'skipped_unsupported',
      summary: 'Tool preflight is not supported.',
    });
  });

  /**
   * @example
   * await tools.readSelfReviewProposal({ proposalId: 'proposal-1' });
   * rejects and records the read exception on the span.
   */
  it('readSelfReviewProposal propagates errors and ends the span with exception details', async () => {
    const { createToolSet } = await import('../shared');
    const error = new Error('Read failed.');
    const tools = createToolSet({
      readProposal: vi.fn().mockRejectedValue(error),
      reserveOperation: vi.fn().mockResolvedValue({ reserved: true }),
      writeReceipt: vi.fn(),
    });

    await expect(
      tools.readSelfReviewProposal({
        proposalId: 'proposal-1',
        proposalKey: 'proposal-key-1',
        userId: 'user-1',
      }),
    ).rejects.toThrow('Read failed.');

    expect(spanRecordException).toHaveBeenCalledWith(error);
    expect(spanSetStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: 'Read failed.',
    });
    expect(spanEnd).toHaveBeenCalled();
  });

  /**
   * @example
   * await tools.listManagedSkills({ agentId: 'agent-1', userId: 'user-1' });
   * returns adapter data and safe unsupported fallbacks for read tools.
   */
  it('read tools call injected adapters and return undefined or empty arrays when unsupported', async () => {
    const { createToolSet } = await import('../shared');
    const listManagedSkills = vi.fn().mockResolvedValue([{ name: 'skill-a' }]);
    const getManagedSkill = vi.fn().mockResolvedValue({ name: 'skill-a' });
    const listSelfReviewProposals = vi.fn().mockResolvedValue([{ proposalId: 'proposal-1' }]);
    const getEvidenceDigest = vi.fn().mockResolvedValue({ evidenceCount: 1 });
    const tools = createToolSet({
      getEvidenceDigest,
      getManagedSkill,
      listSelfReviewProposals,
      listManagedSkills,
      reserveOperation: vi.fn().mockResolvedValue({ reserved: true }),
      writeReceipt: vi.fn(),
    });

    await expect(
      tools.listManagedSkills({ agentId: 'agent-1', userId: 'user-1' }),
    ).resolves.toEqual([{ name: 'skill-a' }]);
    await expect(
      tools.getManagedSkill({
        agentId: 'agent-1',
        skillDocumentId: 'skill-1',
        userId: 'user-1',
      }),
    ).resolves.toEqual({ name: 'skill-a' });
    await expect(
      tools.listSelfReviewProposals({ agentId: 'agent-1', userId: 'user-1' }),
    ).resolves.toEqual([{ proposalId: 'proposal-1' }]);
    await expect(
      tools.getEvidenceDigest({
        agentId: 'agent-1',
        evidenceIds: ['topic-1'],
        reviewWindowEnd: '2026-05-04T14:00:00.000Z',
        reviewWindowStart: '2026-05-03T14:00:00.000Z',
        userId: 'user-1',
      }),
    ).resolves.toEqual({ evidenceCount: 1 });

    expect(listManagedSkills).toHaveBeenCalledWith({ agentId: 'agent-1', userId: 'user-1' });
    expect(getManagedSkill).toHaveBeenCalledWith({
      agentId: 'agent-1',
      skillDocumentId: 'skill-1',
      userId: 'user-1',
    });
    expect(listSelfReviewProposals).toHaveBeenCalledWith({
      agentId: 'agent-1',
      userId: 'user-1',
    });
    expect(getEvidenceDigest).toHaveBeenCalledWith({
      agentId: 'agent-1',
      evidenceIds: ['topic-1'],
      reviewWindowEnd: '2026-05-04T14:00:00.000Z',
      reviewWindowStart: '2026-05-03T14:00:00.000Z',
      userId: 'user-1',
    });
    expect(startActiveSpan).toHaveBeenCalledWith(
      'agent_signal.self_iteration_tool.read',
      expect.objectContaining({
        attributes: expect.objectContaining({
          'agent.signal.self_iteration_tool.name': 'listManagedSkills',
        }),
      }),
      expect.any(Function),
    );

    const unsupportedTools = createToolSet({
      reserveOperation: vi.fn().mockResolvedValue({ reserved: true }),
      writeReceipt: vi.fn(),
    });

    await expect(
      unsupportedTools.listManagedSkills({ agentId: 'agent-1', userId: 'user-1' }),
    ).resolves.toEqual([]);
    await expect(
      unsupportedTools.getManagedSkill({
        agentId: 'agent-1',
        skillDocumentId: 'skill-1',
        userId: 'user-1',
      }),
    ).resolves.toBeUndefined();
    await expect(
      unsupportedTools.listSelfReviewProposals({ agentId: 'agent-1', userId: 'user-1' }),
    ).resolves.toEqual([]);
    await expect(
      unsupportedTools.getEvidenceDigest({ agentId: 'agent-1', userId: 'user-1' }),
    ).resolves.toBeUndefined();
  });

  /**
   * @example
   * await tools.refreshSelfReviewProposal({ proposalId: 'proposal-1' });
   * expect(result.status).toBe('proposed');
   */
  it('refreshSelfReviewProposal returns proposed and writes a receipt', async () => {
    const { createToolSet } = await import('../shared');
    const preflight = vi.fn().mockResolvedValue({ allowed: true });
    const refreshProposal = vi.fn().mockResolvedValue({
      resourceId: 'proposal-1',
      summary: 'Proposal refreshed.',
    });
    const reserveOperation = vi.fn().mockResolvedValue({ reserved: true });
    const writeReceipt = vi.fn().mockResolvedValue({ receiptId: 'receipt-refresh' });
    const tools = createToolSet({
      preflight,
      refreshProposal,
      reserveOperation,
      writeReceipt,
    });

    const result = await tools.refreshSelfReviewProposal({
      idempotencyKey: 'op-refresh-1',
      proposalId: 'proposal-1',
      userId: 'user-1',
    });

    expect(result).toEqual({
      receiptId: 'receipt-refresh',
      resourceId: 'proposal-1',
      status: 'proposed',
      summary: 'Proposal refreshed.',
    });
    expect(writeReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'op-refresh-1',
        status: 'proposed',
      }),
    );
    expect(reserveOperation.mock.invocationCallOrder[0]).toBeLessThan(
      preflight.mock.invocationCallOrder[0],
    );
    expect(reserveOperation.mock.invocationCallOrder[0]).toBeLessThan(
      refreshProposal.mock.invocationCallOrder[0],
    );
  });
});

describe('memory and skill services', () => {
  /**
   * @example
   * Explicit stable preference is passed to the existing memory write adapter.
   */
  it('writes explicit stable memory through the injected adapter', async () => {
    const { createMemoryService } = await import('../shared');
    const writeMemory = vi
      .fn()
      .mockResolvedValue({ memoryId: 'mem-1', summary: 'Saved preference.' });
    const service = createMemoryService({ writeMemory });

    await expect(
      service.writeMemory({
        evidenceRefs: [{ id: 'msg-1', type: 'message' }],
        idempotencyKey: 'source:write_memory:memory:concise',
        input: { content: 'User prefers concise PR summaries.', userId: 'user-1' },
      }),
    ).resolves.toEqual({ memoryId: 'mem-1', summary: 'Saved preference.' });

    expect(writeMemory).toHaveBeenCalledWith({
      content: 'User prefers concise PR summaries.',
      evidenceRefs: [{ id: 'msg-1', type: 'message' }],
      idempotencyKey: 'source:write_memory:memory:concise',
      userId: 'user-1',
    });
  });

  /**
   * @example
   * Sensitive inferred facts are rejected before reaching persistence.
   */
  it('rejects sensitive inferred memory candidates', async () => {
    const { createMemoryService } = await import('../shared');
    const writeMemory = vi.fn();
    const service = createMemoryService({ writeMemory });

    await expect(
      service.writeMemory({
        evidenceRefs: [{ id: 'msg-1', type: 'message' }],
        idempotencyKey: 'source:write_memory:memory:sensitive',
        input: { content: 'User probably has a medical condition.', userId: 'user-1' },
      }),
    ).rejects.toThrow('Memory candidate is not safe for automatic write');

    expect(writeMemory).not.toHaveBeenCalled();
  });

  /**
   * @example
   * Writable managed skill documents may be refined automatically.
   */
  it('refines writable managed skills through the injected adapter', async () => {
    const { createSkillManagementService } = await import('../shared');
    const refineSkill = vi
      .fn()
      .mockResolvedValue({ skillDocumentId: 'doc-1', summary: 'Refined skill.' });
    const service = createSkillManagementService({ refineSkill });

    await expect(
      service.refineSkill({
        evidenceRefs: [{ id: 'msg-1', type: 'message' }],
        idempotencyKey: 'source:refine_skill:skill:doc-1',
        input: {
          bodyMarkdown:
            '# Release notes\n\n- Add checklist step for failed release note validation.',
          skillDocumentId: 'doc-1',
          userId: 'user-1',
        },
      }),
    ).resolves.toEqual({ skillDocumentId: 'doc-1', summary: 'Refined skill.' });

    expect(refineSkill).toHaveBeenCalledOnce();
  });

  /**
   * @example
   * Patch descriptions are not accepted as complete executable skill replacement bodies.
   */
  it('rejects patch-only skill refinements before persistence', async () => {
    const { createSkillManagementService } = await import('../shared');
    const refineSkill = vi.fn();
    const service = createSkillManagementService({ refineSkill });

    await expect(
      service.refineSkill({
        evidenceRefs: [{ id: 'msg-1', type: 'message' }],
        idempotencyKey: 'source:refine_skill:skill:doc-1',
        input: {
          patch: 'Add a checklist step.',
          skillDocumentId: 'doc-1',
          userId: 'user-1',
        },
      }),
    ).rejects.toThrow('Skill refinement requires a complete replacement bodyMarkdown');

    expect(refineSkill).not.toHaveBeenCalled();
  });

  /**
   * @example
   * Readonly builtin or marketplace skills are not mutated by this service.
   */
  it('rejects readonly skill targets before persistence', async () => {
    const { createSkillManagementService } = await import('../shared');
    const refineSkill = vi.fn();
    const service = createSkillManagementService({ refineSkill });

    await expect(
      service.refineSkill({
        evidenceRefs: [{ id: 'builtin-skill', type: 'agent_document' }],
        idempotencyKey: 'source:refine_skill:skill:builtin',
        input: {
          bodyMarkdown: '# Builtin skill\n\nChange builtin skill.',
          skillDocumentId: 'builtin-skill',
          targetReadonly: true,
          userId: 'user-1',
        },
      }),
    ).rejects.toThrow('Skill target is readonly');

    expect(refineSkill).not.toHaveBeenCalled();
  });
});
