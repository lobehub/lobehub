import { describe, expect, it } from 'vitest';

import { chainVerifyReviewPrediction, REVIEW_PREDICT_PROMPT_VERSION } from './verify';

const buildSystemPrompt = () => {
  const { messages } = chainVerifyReviewPrediction({
    title: 'The overview is presented in a standalone floating layer',
    visuals: [{ accessUrl: 'https://example.com/evidence.png' }],
  });

  return messages[0].content;
};

describe('chainVerifyReviewPrediction', () => {
  it('requires affirmative evidence before accepting a check', () => {
    const system = buildSystemPrompt();

    expect(system).toContain('Accept only when the attached evidence visibly and sufficiently');
    expect(system).toContain('The absence of a visible defect is not proof of success');
  });

  it('rejects invalid or insufficient evidence instead of treating uncertainty as acceptance', () => {
    const system = buildSystemPrompt();

    expect(system).toContain(
      'Reject when the expected product state is missing, blank, still loading, replaced by an error or placeholder',
    );
    expect(system).toContain(
      'Reject when the verifier reasoning or cited evidence says the target could not be loaded, reached, exercised, or observed',
    );
    expect(system).toContain(
      'Missing, invalid, or insufficient evidence is a failed acceptance check',
    );
    expect(system).not.toContain('accept despite being unsure');
    expect(system).not.toContain('if the check depends on one of those, accept');
  });

  it('uses a new prompt cohort for the stricter evidence contract', () => {
    expect(REVIEW_PREDICT_PROMPT_VERSION).toBe('v2');
  });
});
