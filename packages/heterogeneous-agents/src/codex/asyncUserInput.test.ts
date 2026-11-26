import { describe, expect, it } from 'vitest';

import {
  codexAsyncAnswers,
  formatCodexAsyncReplies,
  readCodexAsyncQuestion,
} from './asyncUserInput';

describe('Codex async question replies', () => {
  it('returns selected and free-text answers with their original question IDs', () => {
    const request = readCodexAsyncQuestion({
      item: {
        delivery: 'async',
        id: 'call-1',
        questions: [
          { options: ['Staging', 'Production'], title: 'Which environment?' },
          { options: null, title: 'Any notes?' },
        ],
        type: 'agentMessage',
      },
    });
    expect(request).toBeDefined();
    const content = formatCodexAsyncReplies(
      codexAsyncAnswers(request!, {
        result: { 'Any notes?': 'Use a "dry run"\nfirst.', 'Which environment?': 'Staging' },
      }),
    );
    expect(content).toBe(
      '<send_user_message_question_reply>\n' +
        '[{"answer":"Staging","question":"Which environment?",' +
        '"questionItemId":"[\\"request_user_input_async\\",\\"call-1\\",0]"},' +
        '{"answer":"Use a \\"dry run\\"\\nfirst.","question":"Any notes?",' +
        '"questionItemId":"[\\"request_user_input_async\\",\\"call-1\\",1]"}]\n' +
        '</send_user_message_question_reply>',
    );
  });

  it('keeps duplicate prompt titles separately answerable', () => {
    const request = readCodexAsyncQuestion({
      item: {
        delivery: 'async',
        id: 'call-2',
        questions: [{ title: 'Name?' }, { options: [], title: 'Name?' }],
        type: 'agentMessage',
      },
    });
    expect(codexAsyncAnswers(request!, { result: { 'Name?': 'Foo', 'Name? (2)': 'Bar' } })).toEqual(
      [
        {
          answer: 'Foo',
          question: 'Name?',
          questionItemId: '["request_user_input_async","call-2",0]',
        },
        {
          answer: 'Bar',
          question: 'Name?',
          questionItemId: '["request_user_input_async","call-2",1]',
        },
      ],
    );
  });
});
