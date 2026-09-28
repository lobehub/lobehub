// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { describeWithheldEvidence } from '../reviewInspection';

const shot = (id: string, description?: string) => ({ description, id, type: 'screenshot' });

/**
 * Regression: a check carrying five frames was reviewed on three of them, and the
 * other two were dropped without a word. The prompt then asked for affirmative
 * proof, so the model answered "not observable in the evidence" about artifacts
 * that existed and had been withheld from the request.
 */
describe('describeWithheldEvidence', () => {
  it('names the frames that did not fit the request, with their captions', () => {
    const withheld = describeWithheldEvidence({
      attachedVisualIds: new Set(['a', 'b', 'c']),
      evidence: [
        shot('a'),
        shot('b'),
        shot('c'),
        shot('d', 'verification screenshot for unit U208'),
        shot('e', 'verification screenshot for unit U223'),
      ],
      includedTextIds: new Set(),
      textLaneEnabled: true,
    });

    expect(withheld).toContain('2 more frame(s)');
    expect(withheld).toContain('at most 3');
    expect(withheld).toContain('unit U208');
    expect(withheld).toContain('unit U223');
  });

  it('says nothing when the reviewer saw every artifact', () => {
    expect(
      describeWithheldEvidence({
        attachedVisualIds: new Set(['a']),
        evidence: [shot('a'), { id: 'b', type: 'text' }],
        includedTextIds: new Set(['b']),
        textLaneEnabled: true,
      }),
    ).toBeUndefined();
  });

  it('declares media this reviewer cannot open at all', () => {
    const withheld = describeWithheldEvidence({
      attachedVisualIds: new Set(['a']),
      evidence: [
        shot('a'),
        { description: 'screen recording of the drag', id: 'v', type: 'video' },
      ],
      includedTextIds: new Set(),
      textLaneEnabled: true,
    });
    expect(withheld).toContain('cannot open at all');
    expect(withheld).toContain('screen recording of the drag');
  });

  it('separates an unresolved payload from a lane that reads frames only', () => {
    const evidence = [shot('a'), { description: 'command output', id: 't', type: 'text' }];
    expect(
      describeWithheldEvidence({
        attachedVisualIds: new Set(['a']),
        evidence,
        includedTextIds: new Set(),
        textLaneEnabled: true,
      }),
    ).toContain('could not be resolved');
    expect(
      describeWithheldEvidence({
        attachedVisualIds: new Set(['a']),
        evidence,
        includedTextIds: new Set(),
        textLaneEnabled: false,
      }),
    ).toContain('reads frames only');
  });
});
