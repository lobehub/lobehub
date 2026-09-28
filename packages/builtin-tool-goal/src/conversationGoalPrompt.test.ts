import { describe, expect, it } from 'vitest';

import { conversationGoalPrompt, withConversationGoalPrompt } from './conversationGoalPrompt';
import { stripGoalCommand } from './goalPrompt';

describe('stripGoalCommand', () => {
  it("sends a CLI agent the request without /goal, so Claude Code's own /goal does not take it", () => {
    expect(stripGoalCommand('/goal ship the report')).toBe('ship the report');
    expect(stripGoalCommand('  /GOAL\nship the report')).toBe('ship the report');
  });

  it('leaves every other prompt untouched', () => {
    expect(stripGoalCommand('fix the build')).toBe('fix the build');
    expect(stripGoalCommand('/goals are nice')).toBe('/goals are nice');
    expect(stripGoalCommand(undefined)).toBeUndefined();
  });
});

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

  it('plans from the create output instead of reading the goal back', () => {
    // A device run holds an operation token, which the goal read endpoint
    // refuses; telling the agent to run `lh goal show` made its first command
    // after create fail and pushed it to work around its own credentials.
    expect(conversationGoalPrompt).not.toContain('Run lh goal show');
    expect(conversationGoalPrompt).toContain('do not run lh goal show');
  });
});
