import { describe, expect, it } from 'vitest';

import {
  getSelfFeedbackIntentTargetSignature,
  groupSelfFeedbackIntents,
  normalizeReflectionIntent,
  rankSelfFeedbackCandidates,
  squashSelfFeedbackIntentGroup,
} from '../intentPolicy';

describe('self-review intent policy', () => {
  /**
   * @example
   * normalizeReflectionIntent({ confidence: undefined }).confidence === 0.5;
   */
  it('defaults missing confidence to 0.5', () => {
    expect(
      normalizeReflectionIntent({
        evidenceRefs: [],
        idempotencyKey: 'intent-1',
        intentType: 'workflow',
        mode: 'reflection',
        rationale: 'Review this later.',
        risk: 'low',
        urgency: 'later',
      }).confidence,
    ).toBe(0.5);
  });

  /**
   * @example
   * skill refine intents targeting the same skill are grouped together.
   */
  it('groups intents by intent type action type and target signature', () => {
    const groups = groupSelfFeedbackIntents([
      normalizeReflectionIntent({
        actionType: 'refine_skill',
        confidence: 0.7,
        evidenceRefs: [{ id: 'msg-1', type: 'message' }],
        idempotencyKey: 'intent-1',
        intentType: 'skill',
        mode: 'reflection',
        rationale: 'Refine release note checklist.',
        risk: 'medium',
        target: { skillDocumentId: 'skill-1' },
        urgency: 'soon',
      }),
      normalizeReflectionIntent({
        actionType: 'refine_skill',
        confidence: 0.8,
        evidenceRefs: [{ id: 'msg-2', type: 'message' }],
        idempotencyKey: 'intent-2',
        intentType: 'skill',
        mode: 'reflection',
        rationale: 'Same target.',
        risk: 'medium',
        target: { skillDocumentId: 'skill-1' },
        urgency: 'later',
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('skill:refine_skill:skill:skill-1');
  });

  /**
   * @example
   * repeated evidence uses max confidence rather than summing confidence.
   */
  it('uses max confidence without inflating repeated evidence', () => {
    const group = groupSelfFeedbackIntents([
      normalizeReflectionIntent({
        actionType: 'write_memory',
        confidence: 0.6,
        evidenceRefs: [{ id: 'msg-1', type: 'message' }],
        idempotencyKey: 'intent-1',
        intentType: 'memory',
        mode: 'reflection',
        rationale: 'Remember preference.',
        risk: 'low',
        target: { memoryId: 'memory-1' },
        urgency: 'later',
      }),
      normalizeReflectionIntent({
        actionType: 'write_memory',
        confidence: 0.7,
        evidenceRefs: [{ id: 'msg-2', type: 'message' }],
        idempotencyKey: 'intent-2',
        intentType: 'memory',
        mode: 'reflection',
        rationale: 'Same preference.',
        risk: 'low',
        target: { memoryId: 'memory-1' },
        urgency: 'soon',
      }),
    ])[0];

    expect(squashSelfFeedbackIntentGroup(group).confidence).toBe(0.7);
  });

  /**
   * @example
   * repeated medium intents become stronger evidence without changing aggregate confidence.
   */
  it('promotes repeated matching intents to stronger evidence strength', () => {
    const group = groupSelfFeedbackIntents([
      normalizeReflectionIntent({
        actionType: 'write_memory',
        confidence: 0.55,
        evidenceRefs: [{ id: 'msg-1', type: 'message' }],
        idempotencyKey: 'intent-1',
        intentType: 'memory',
        mode: 'reflection',
        rationale: 'Remember preference.',
        risk: 'low',
        target: { memoryId: 'memory-1' },
        urgency: 'later',
      }),
      normalizeReflectionIntent({
        actionType: 'write_memory',
        confidence: 0.55,
        evidenceRefs: [{ id: 'msg-2', type: 'message' }],
        idempotencyKey: 'intent-2',
        intentType: 'memory',
        mode: 'reflection',
        rationale: 'Same preference.',
        risk: 'low',
        target: { memoryId: 'memory-1' },
        urgency: 'later',
      }),
    ])[0];

    expect(squashSelfFeedbackIntentGroup(group).evidenceStrength).toBe('strong');
  });

  /**
   * @example
   * immediate candidates sort before soon and later candidates.
   */
  it('ranks immediate urgency before soon and later', () => {
    const ranked = rankSelfFeedbackCandidates(
      groupSelfFeedbackIntents(
        ['later', 'immediate', 'soon'].map((urgency, index) =>
          normalizeReflectionIntent({
            actionType: 'write_memory',
            confidence: 0.8,
            evidenceRefs: [{ id: `msg-${index}`, type: 'message' }],
            idempotencyKey: `intent-${index}`,
            intentType: 'memory',
            mode: 'reflection',
            rationale: 'Remember preference.',
            risk: 'low',
            target: { memoryId: `memory-${index}` },
            urgency: urgency as 'immediate' | 'later' | 'soon',
          }),
        ),
      ),
    );

    expect(ranked.map((candidate) => candidate.intent.urgency)).toEqual([
      'immediate',
      'soon',
      'later',
    ]);
  });

  /**
   * @example
   * strong candidates with operation payloads become proposal-priority evidence.
   */
  it('marks strong candidates with target or operation as proposal-priority evidence', () => {
    const [candidate] = rankSelfFeedbackCandidates(
      groupSelfFeedbackIntents([
        normalizeReflectionIntent({
          actionType: 'refine_skill',
          confidence: 0.9,
          evidenceRefs: [{ id: 'msg-1', type: 'message' }],
          idempotencyKey: 'intent-1',
          intentType: 'skill',
          mode: 'reflection',
          operation: {
            domain: 'skill',
            input: {
              bodyMarkdown: '# Skill',
              skillDocumentId: 'skill-1',
              userId: 'user-1',
            },
            operation: 'refine',
          },
          rationale: 'Refine checklist.',
          risk: 'medium',
          target: { skillDocumentId: 'skill-1' },
          urgency: 'soon',
        }),
      ]),
    );

    expect(candidate.reviewBehavior).toBe('proposal_priority');
    expect(getSelfFeedbackIntentTargetSignature(candidate.intent)).toBe('skill:skill-1');
  });
});
