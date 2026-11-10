import { buildGoalManagerPrompt } from '@lobechat/prompts';
import { describe, expect, it } from 'vitest';

import { LONG_MESSAGE_THRESHOLD, shouldPreviewLongMessage } from './longMessage';

describe('shouldPreviewLongMessage', () => {
  it('previews an ordinary message past the threshold', () => {
    expect(shouldPreviewLongMessage('x'.repeat(LONG_MESSAGE_THRESHOLD + 1))).toBe(true);
    expect(shouldPreviewLongMessage('x'.repeat(LONG_MESSAGE_THRESHOLD))).toBe(false);
  });

  /**
   * Regression: 20 new comments near the 2,000-character cap push a manager turn
   * past the threshold, and the preview drops the goalTurn card entirely.
   */
  it('keeps a feedback-heavy goal manager turn on the card renderer', () => {
    const prompt = buildGoalManagerPrompt({
      earlierFeedback: [],
      goalId: 'goal_1',
      maxTurns: 12,
      newFeedback: Array.from({ length: 20 }, (_, i) => ({
        author: 'user',
        content: `comment ${i} `.repeat(200),
        taskId: `task_${i}`,
        updatedAt: '2026-10-06T00:00:00.000Z',
      })),
      omittedFeedback: { earlier: 0, new: 0 },
      requirement: 'r',
      token: 't',
      turn: 2,
    });
    expect(prompt.length).toBeGreaterThan(LONG_MESSAGE_THRESHOLD);
    expect(shouldPreviewLongMessage(prompt)).toBe(false);
  });
});
