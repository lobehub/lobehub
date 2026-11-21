import { describe, expect, it } from 'vitest';

import { ClaudeCodeAdapter } from './claudeCode';

describe('ClaudeCodeAdapter prompt suggestions', () => {
  it('maps a suggestion to a step_complete phase', () => {
    const [event] = new ClaudeCodeAdapter().adapt({
      session_id: 'sess_1',
      suggestion: 'Now do step 3 only.',
      type: 'prompt_suggestion',
      uuid: 'uuid_1',
    });

    expect(event.type).toBe('step_complete');
    expect(event.data).toEqual({ phase: 'prompt_suggestion', suggestion: 'Now do step 3 only.' });
  });

  it('emits nothing for an empty suggestion', () => {
    expect(new ClaudeCodeAdapter().adapt({ suggestion: '  ', type: 'prompt_suggestion' })).toEqual(
      [],
    );
  });
});
