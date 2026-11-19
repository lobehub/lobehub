import { describe, expect, it } from 'vitest';

import {
  codexAsyncQuestionId,
  displayCodexAsyncReplies,
  formatCodexAsyncReplies,
  parseCodexAsyncReplies,
} from './asyncUserInput';

describe('Codex async question replies', () => {
  it('sends multiple answers in the native user-message envelope with stable question IDs', () => {
    const content = formatCodexAsyncReplies([
      {
        answer: 'Staging',
        question: 'Which environment?',
        questionItemId: codexAsyncQuestionId('call-1', 0),
      },
      {
        answer: 'Use a "dry run"\nfirst.',
        question: 'Any notes?',
        questionItemId: codexAsyncQuestionId('call-1', 1),
      },
    ]);
    expect(content).toBe(
      '<send_user_message_question_reply>\n' +
        '[{"answer":"Staging","question":"Which environment?",' +
        '"questionItemId":"[\\"request_user_input_async\\",\\"call-1\\",0]"},' +
        '{"answer":"Use a \\"dry run\\"\\nfirst.","question":"Any notes?",' +
        '"questionItemId":"[\\"request_user_input_async\\",\\"call-1\\",1]"}]\n' +
        '</send_user_message_question_reply>',
    );
    expect(parseCodexAsyncReplies(content)[1]?.answer).toBe('Use a "dry run"\nfirst.');
  });

  it('preserves ordinary messages that mention the envelope tag', () => {
    expect(
      parseCodexAsyncReplies('Use <send_user_message_question_reply> in a user reply.'),
    ).toEqual([]);
    expect(
      parseCodexAsyncReplies(
        '<send_user_message_question_reply>not JSON</send_user_message_question_reply>',
      ),
    ).toEqual([]);
  });

  it('keeps a reply identifiable when the conversation merges queued messages', () => {
    const reply = { answer: 'Yes', question: 'Use staging?', questionItemId: 'question-1' };
    const merged = `Check the logs.\n\n${formatCodexAsyncReplies([reply])}\n\nUse the test account.`;

    expect(parseCodexAsyncReplies(merged)).toEqual([reply]);
    expect(displayCodexAsyncReplies(merged)).toBe(
      'Check the logs.\n\nUse staging?\n\nYes\n\nUse the test account.',
    );
  });
});
