import { describe, expect, it } from 'vitest';

import { getVoiceReply } from './reply';

describe('getVoiceReply', () => {
  it('reads the final reply after tools, excluding reasoning and unrelated operations', () => {
    expect(
      getVoiceReply(
        [
          { id: 'user', role: 'user', content: 'Find it' },
          { id: 'call', parentId: 'user', role: 'assistant', content: 'Searching', tools: [{}] },
          { id: 'tool', parentId: 'call', role: 'tool', content: 'Tool result' },
          { id: 'answer', parentId: 'tool', role: 'assistant', content: 'Here it is.' },
          { id: 'other', parentId: 'someone-else', role: 'assistant', content: 'Unrelated' },
        ],
        'user',
      ),
    ).toBe('Here it is.');
  });

  it('handles out-of-order persisted tool results', () => {
    expect(
      getVoiceReply(
        [
          { id: 'answer', parentId: 'tool', role: 'assistant', content: 'Done' },
          { id: 'tool', parentId: 'call', role: 'tool' },
          { id: 'call', parentId: 'user', role: 'assistant', tools: [{}] },
        ],
        'user',
      ),
    ).toBe('Done');
  });

  it('does not read a failed response or tool output as the answer', () => {
    expect(() =>
      getVoiceReply(
        [
          {
            id: 'error',
            parentId: 'user',
            role: 'assistant',
            content: 'Secret provider error',
            error: {},
          },
          { id: 'tool', parentId: 'user', role: 'tool', content: 'Raw tool output' },
        ],
        'user',
      ),
    ).toThrow('did not return');
  });
});
