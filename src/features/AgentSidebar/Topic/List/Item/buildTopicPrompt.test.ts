import { describe, expect, it } from 'vitest';

import { buildTopicPrompt } from './buildTopicPrompt';

describe('buildTopicPrompt', () => {
  it('includes title, id and the CLI read command', () => {
    expect(buildTopicPrompt({ id: 'tpc_1', title: ' Debug CI ' })).toBe(
      [
        'LobeHub topic: Debug CI (tpc_1)',
        '',
        'Use the LobeHub CLI to read the full conversation history of this topic:',
        '',
        'lh topic view tpc_1 -L 500',
        '',
        'If the topic has more than 500 messages, page through the remainder with --from and --to.',
      ].join('\n'),
    );
  });

  it('falls back to the bare id when the title is blank', () => {
    expect(
      buildTopicPrompt({ id: 'tpc_1', title: '  ' }).startsWith('LobeHub topic: tpc_1\n\n'),
    ).toBe(true);
  });
});
