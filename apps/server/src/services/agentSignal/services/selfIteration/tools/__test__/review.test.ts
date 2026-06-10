import { describe, expect, it, vi } from 'vitest';

import { ReviewTools } from '../review';
import { createToolSet, ToolSetFacade } from '../shared';

const createToolSetFacade = () =>
  new ToolSetFacade({
    closeProposal: vi.fn().mockResolvedValue({ resourceId: 'proposal-1' }),
    createProposal: vi.fn().mockResolvedValue({ proposalId: 'proposal-1' }),
    preflight: vi.fn().mockResolvedValue({ allowed: true }),
    refreshProposal: vi.fn().mockResolvedValue({ resourceId: 'proposal-1' }),
    reserveOperation: vi.fn().mockResolvedValue({ reserved: true }),
    supersedeProposal: vi.fn().mockResolvedValue({ resourceId: 'proposal-1' }),
    writeReceipt: vi.fn().mockResolvedValue({ receiptId: 'receipt-1' }),
  });

describe('ReviewTools', () => {
  /**
   * @example
   * await tools.createSelfReviewProposal({ proposalKey: 'review:1' });
   * expect(result.status).toBe('proposed');
   */
  it('uses self-review names for proposal lifecycle operations', async () => {
    const tools = new ReviewTools(createToolSetFacade());

    await expect(
      tools.createSelfReviewProposal({
        idempotencyKey: 'op-proposal-1',
        proposalKey: 'review:proposal:1',
        userId: 'user-1',
      }),
    ).resolves.toEqual({
      receiptId: 'receipt-1',
      resourceId: 'proposal-1',
      status: 'proposed',
    });
  });

  /**
   * @example
   * await tools.recordSelfReviewIdea(idea);
   * expect(result.status).toBe('applied');
   */
  it('records self-review ideas through the review adapter', async () => {
    const recordSelfReviewIdea = vi.fn().mockResolvedValue({
      resourceId: 'idea-1',
      status: 'applied',
    });
    const tools = new ReviewTools(createToolSetFacade(), { recordSelfReviewIdea });

    await expect(
      tools.recordSelfReviewIdea({
        evidenceRefs: [{ id: 'msg-1', type: 'message' }],
        idempotencyKey: 'idea-1',
        rationale: 'Keep this for later review.',
        risk: 'low',
      }),
    ).resolves.toEqual({ resourceId: 'idea-1', status: 'applied' });

    expect(recordSelfReviewIdea).toHaveBeenCalledOnce();
  });

  /**
   * @example
   * expect(createToolSet).toBeTypeOf('function');
   */
  it('exports the shared factory used by concrete review tools', () => {
    expect(createToolSet).toBeTypeOf('function');
  });
});
