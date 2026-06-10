// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { renderMessageContext } from '../messageContextRenderer';

describe('renderMessageContext', () => {
  it('renders stable xml sections for feedback analysis context', () => {
    const xml = renderMessageContext({
      feedbackMessage: {
        content: 'Please keep responses shorter.',
        id: 'feedback-1',
        role: 'user',
      },
      latestAssistantReply: {
        content: 'Here is a long explanation.',
        id: 'assistant-2',
        role: 'assistant',
      },
      recentMessages: [
        { content: 'Hi', id: 'user-1', role: 'user' },
        { content: 'Hello <there>', id: 'assistant-1', role: 'assistant' },
      ],
    });

    expect(xml).toContain('<feedback_analysis_context>');
    expect(xml).toContain('<conversation>');
    expect(xml).toContain('<latest_assistant_reply>');
    expect(xml).toContain('<feedback_message>');
    expect(xml).toContain('&lt;there&gt;');
  });
});
