import { SpanStatusCode } from '@lobechat/observability-otel/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('createMaintenanceTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * @example
   * await tools.replaceSkillContentCAS({ baseRevision: 'old' });
   * expect(result.status).toBe('skipped_stale');
   */
  it('replaceSkillContentCAS returns skipped_stale without writing when preflight fails', async () => {
    const { createMaintenanceTools } = await import('../tools');
    const replaceSkill = vi.fn();
    const writeReceipt = vi.fn().mockResolvedValue({ receiptId: 'receipt-stale' });
    const tools = createMaintenanceTools({
      preflight: vi.fn().mockResolvedValue({ allowed: false, reason: 'Document changed.' }),
      replaceSkill,
      reserveOperation: vi.fn().mockResolvedValue({ reserved: true }),
      writeReceipt,
    });

    const result = await tools.replaceSkillContentCAS({
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
    const { createMaintenanceTools } = await import('../tools');
    const preflight = vi.fn();
    const replaceSkill = vi.fn();
    const writeReceipt = vi.fn().mockResolvedValue({ receiptId: 'receipt-deduped' });
    const tools = createMaintenanceTools({
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
   * await tools.createMaintenanceProposal({ proposalKey: 'p1' });
   * expect(result.status).toBe('proposed');
   */
  it('createMaintenanceProposal returns proposed and writes a receipt', async () => {
    const { createMaintenanceTools } = await import('../tools');
    const createProposal = vi.fn().mockResolvedValue({
      proposalId: 'proposal-1',
      summary: 'Proposal created.',
    });
    const writeReceipt = vi.fn().mockResolvedValue({ receiptId: 'receipt-proposed' });
    const tools = createMaintenanceTools({
      createProposal,
      reserveOperation: vi.fn().mockResolvedValue({ reserved: true }),
      writeReceipt,
    });

    const result = await tools.createMaintenanceProposal({
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
      'agent_signal.maintenance_tool.write',
      expect.objectContaining({
        attributes: expect.objectContaining({
          'agent.signal.maintenance_tool.name': 'createMaintenanceProposal',
          'agent.signal.proposal.key': 'proposal-skill-1',
        }),
      }),
      expect.any(Function),
    );
    expect(spanSetAttribute).toHaveBeenCalledWith(
      'agent.signal.maintenance_tool.write_status',
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
    const { createMaintenanceTools } = await import('../tools');
    const error = new Error('Skill write failed.');
    const writeReceipt = vi.fn().mockResolvedValue({ receiptId: 'receipt-failed' });
    const tools = createMaintenanceTools({
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
   * await tools.createMaintenanceProposal({ idempotencyKey: 'op-receipt-fails' });
   * rejects when the terminal receipt cannot be written.
   */
  it('createMaintenanceProposal propagates receipt failures and records the write span exception', async () => {
    const { createMaintenanceTools } = await import('../tools');
    const error = new Error('Receipt write failed.');
    const markOperationFailed = vi.fn().mockResolvedValue(undefined);
    const tools = createMaintenanceTools({
      createProposal: vi.fn().mockResolvedValue({
        proposalId: 'proposal-1',
        summary: 'Proposal created.',
      }),
      markOperationFailed,
      reserveOperation: vi.fn().mockResolvedValue({ reserved: true }),
      writeReceipt: vi.fn().mockRejectedValue(error),
    });

    await expect(
      tools.createMaintenanceProposal({
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
        toolName: 'createMaintenanceProposal',
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
    const { createMaintenanceTools } = await import('../tools');
    const writeReceipt = vi.fn().mockResolvedValue({ receiptId: 'receipt-replace' });
    const tools = createMaintenanceTools({
      preflight: vi.fn().mockResolvedValue({ allowed: true }),
      replaceSkill: vi.fn().mockResolvedValue({ summary: 'Skill replaced.' }),
      reserveOperation: vi.fn().mockResolvedValue({ reserved: true }),
      writeReceipt,
    });

    const result = await tools.replaceSkillContentCAS({
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
   * await tools.closeMaintenanceProposal({ proposalId: 'proposal-1' });
   * expect(result.status).toBe('skipped_unsupported');
   */
  it('closeMaintenanceProposal skips unsupported when preflight is missing and does not mutate', async () => {
    const { createMaintenanceTools } = await import('../tools');
    const closeProposal = vi.fn();
    const tools = createMaintenanceTools({
      closeProposal,
      reserveOperation: vi.fn().mockResolvedValue({ reserved: true }),
      writeReceipt: vi.fn().mockResolvedValue({ receiptId: 'receipt-unsupported' }),
    });

    const result = await tools.closeMaintenanceProposal({
      idempotencyKey: 'op-close-1',
      proposalId: 'proposal-1',
      userId: 'user-1',
    });

    expect(closeProposal).not.toHaveBeenCalled();
    expect(result).toEqual({
      receiptId: 'receipt-unsupported',
      resourceId: 'proposal-1',
      status: 'skipped_unsupported',
      summary: 'Maintenance preflight is not supported.',
    });
  });

  /**
   * @example
   * await tools.readMaintenanceProposal({ proposalId: 'proposal-1' });
   * rejects and records the read exception on the span.
   */
  it('readMaintenanceProposal propagates errors and ends the span with exception details', async () => {
    const { createMaintenanceTools } = await import('../tools');
    const error = new Error('Read failed.');
    const tools = createMaintenanceTools({
      readProposal: vi.fn().mockRejectedValue(error),
      reserveOperation: vi.fn().mockResolvedValue({ reserved: true }),
      writeReceipt: vi.fn(),
    });

    await expect(
      tools.readMaintenanceProposal({
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
   * await tools.refreshMaintenanceProposal({ proposalId: 'proposal-1' });
   * expect(result.status).toBe('proposed');
   */
  it('refreshMaintenanceProposal returns proposed and writes a receipt', async () => {
    const { createMaintenanceTools } = await import('../tools');
    const preflight = vi.fn().mockResolvedValue({ allowed: true });
    const refreshProposal = vi.fn().mockResolvedValue({
      resourceId: 'proposal-1',
      summary: 'Proposal refreshed.',
    });
    const reserveOperation = vi.fn().mockResolvedValue({ reserved: true });
    const writeReceipt = vi.fn().mockResolvedValue({ receiptId: 'receipt-refresh' });
    const tools = createMaintenanceTools({
      preflight,
      refreshProposal,
      reserveOperation,
      writeReceipt,
    });

    const result = await tools.refreshMaintenanceProposal({
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
