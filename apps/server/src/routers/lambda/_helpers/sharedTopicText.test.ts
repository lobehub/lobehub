import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { sharedTopicText } from './sharedTopicText';

const message = (
  id: string,
  role: UIChatMessage['role'],
  content: string,
  parentId?: string,
  extra: Partial<UIChatMessage> = {},
): UIChatMessage => ({
  content,
  createdAt: Number(id),
  id,
  parentId,
  role,
  updatedAt: Number(id),
  ...extra,
});
const tools = [
  { apiName: 'search', arguments: '{}', id: 'call', identifier: 'web', type: 'builtin' as const },
];

describe('sharedTopicText', () => {
  it('keeps user prompts and final answers while excluding tools, reasoning and preambles', () => {
    const result = sharedTopicText([
      message('1', 'user', 'What happened?'),
      message('2', 'assistant', 'I will investigate.', '1', { tools }),
      message('3', 'tool', 'Internal tool output', '2', { tool_call_id: 'call' }),
      message('4', 'assistant', 'The final conclusion.', '3', {
        reasoning: { content: 'Private reasoning' },
      }),
      message('5', 'user', 'What next?', '4'),
      message('6', 'assistant', 'The next step.', '5'),
    ]);
    expect(result).toBe(
      '## User\n\nWhat happened?\n\n## Assistant\n\nThe final conclusion.\n\n## User\n\nWhat next?\n\n## Assistant\n\nThe next step.',
    );
  });

  it('does not turn an unfinished tool run into a conclusion', () => {
    expect(
      sharedTopicText([
        message('1', 'user', 'Investigate'),
        message('2', 'assistant', 'I will investigate.', '1'),
        message('3', 'assistant', 'Still searching.', '2', { tools }),
      ]),
    ).toBe('## User\n\nInvestigate');
  });
});
