import { describe, expect, it } from 'vitest';

import { conversationGoalPrompt, withConversationGoalPrompt } from './conversationGoalPrompt';

describe('withConversationGoalPrompt', () => {
  it('leaves an ordinary message context untouched', () => {
    expect(withConversationGoalPrompt('Repo rules', 'fix the build')).toBe('Repo rules');
    expect(withConversationGoalPrompt(undefined, 'fix the build')).toBeUndefined();
  });

  it('appends the /goal instructions after the agent context', () => {
    expect(withConversationGoalPrompt('Repo rules', '/goal ship the report')).toBe(
      `Repo rules\n\n${conversationGoalPrompt}`,
    );
  });

  it('injects the instructions alone when the agent has no context', () => {
    expect(withConversationGoalPrompt('  ', '/goal ship the report')).toBe(conversationGoalPrompt);
  });

  it('tells the agent to create the goal from this conversation and plan it in the same run', () => {
    expect(conversationGoalPrompt).toContain('lh goal create');
    expect(conversationGoalPrompt).toContain('--conversation');
    expect(conversationGoalPrompt).toContain('lh goal plan <goalId> --token <turnToken>');
  });
});
