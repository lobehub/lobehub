import { describe, expect, it, vi } from 'vitest';

import { getReflectionDisposition, ReflectionTools } from '../reflection';

describe('ReflectionTools', () => {
  /**
   * @example
   * getReflectionDisposition({ actionType: 'write_memory', confidence: 0.8 });
   * returns direct_apply only when every memory safety predicate passes.
   */
  it('direct-applies only supported high-confidence reflection candidates', () => {
    expect(
      getReflectionDisposition({
        actionType: 'write_memory',
        concreteFutureUse: true,
        confidence: 0.75,
        evidenceStrength: 'medium',
        usableMemoryContent: true,
      }),
    ).toBe('direct_apply');

    expect(
      getReflectionDisposition({
        actionType: 'write_memory',
        concreteFutureUse: true,
        confidence: 0.74,
        evidenceStrength: 'medium',
        usableMemoryContent: true,
      }),
    ).toBe('record_intent');

    expect(
      getReflectionDisposition({
        actionType: 'write_memory',
        concreteFutureUse: true,
        confidence: 0.95,
        evidenceStrength: 'strong',
        sensitive: true,
        usableMemoryContent: true,
      }),
    ).toBe('record_intent');

    expect(
      getReflectionDisposition({
        actionType: 'refine_skill',
        confidence: 0.9,
        evidenceStrength: 'strong',
        inPlacePatch: true,
        smallMutationScope: true,
        targetSkillDocumentId: 'skill-1',
      }),
    ).toBe('direct_apply');

    expect(
      getReflectionDisposition({
        actionType: 'consolidate_skill',
        confidence: 1,
        evidenceStrength: 'strong',
      }),
    ).toBe('record_intent');
  });

  /**
   * @example
   * await tools.recordReflectionIdea(idea);
   * expect(result.status).toBe('applied');
   */
  it('records reflection ideas through receipt-backed adapters', async () => {
    const recordReflectionIdea = vi.fn().mockResolvedValue({
      resourceId: 'idea-1',
      status: 'applied',
    });
    const tools = new ReflectionTools({ recordReflectionIdea });

    await expect(
      tools.recordReflectionIdea({
        evidenceRefs: [{ id: 'msg-1', type: 'message' }],
        idempotencyKey: 'idea-1',
        rationale: 'The agent noticed a local failure pattern.',
        risk: 'low',
      }),
    ).resolves.toEqual({ resourceId: 'idea-1', status: 'applied' });

    expect(recordReflectionIdea).toHaveBeenCalledOnce();
  });

  /**
   * @example
   * await tools.recordSelfFeedbackIntent(intent);
   * expect(result.status).toBe('applied');
   */
  it('records downgraded self-feedback intents without review proposal tools', async () => {
    const recordSelfFeedbackIntent = vi.fn().mockResolvedValue({
      resourceId: 'intent-1',
      status: 'applied',
    });
    const tools = new ReflectionTools({ recordSelfFeedbackIntent });

    await expect(
      tools.recordSelfFeedbackIntent({
        confidence: 0.62,
        downgradeReason: 'low_confidence',
        evidenceRefs: [{ id: 'tool-1', type: 'tool_call' }],
        idempotencyKey: 'intent-1',
        intentType: 'workflow',
        mode: 'reflection',
        rationale: 'The agent should revisit this pattern during self-review.',
        risk: 'medium',
        urgency: 'soon',
      }),
    ).resolves.toEqual({ resourceId: 'intent-1', status: 'applied' });

    expect(recordSelfFeedbackIntent).toHaveBeenCalledOnce();
    expect('createSelfReviewProposal' in tools).toBe(false);
  });
});
