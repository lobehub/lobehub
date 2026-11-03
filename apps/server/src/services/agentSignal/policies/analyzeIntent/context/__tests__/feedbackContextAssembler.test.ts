// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  assembleFeedbackContext,
  FEEDBACK_CONTEXT_RECENT_MESSAGE_LIMIT,
} from '../feedbackContextAssembler';

describe('assembleFeedbackContext', () => {
  it('returns rendered context and resolves the latest assistant reply from recent messages', () => {
    const messages = Array.from({ length: 12 }, (_, index) => ({
      content: `message-${index + 1}`,
      id: `message-${index + 1}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
    }));

    const result = assembleFeedbackContext({
      feedbackMessage: {
        content: 'Use bullet points next time.',
        id: 'feedback-1',
        role: 'user',
      },
      messages,
    });

    expect(result.recentMessages).toHaveLength(FEEDBACK_CONTEXT_RECENT_MESSAGE_LIMIT);
    expect(result.recentMessages[0]?.id).toBe('message-3');
    expect(result.latestAssistantReply).toEqual(
      expect.objectContaining({
        id: 'message-12',
        role: 'assistant',
      }),
    );
    expect(result.serializedContext).toContain('<feedback_analysis_context>');
    expect(result.serializedContext).toContain('message-12');
    expect(result.serializedContext).toContain('Use bullet points next time.');
  });
});
