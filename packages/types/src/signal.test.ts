import { describe, expect, it } from 'vitest';

import { parseBotNoReplyToken } from './signal';

describe('parseBotNoReplyToken', () => {
  it.each([
    ['NO_REPLY', 'unspecified'],
    ['  NO_REPLY\n', 'unspecified'],
    ['`NO_REPLY`', 'unspecified'],
    ['no_reply', 'unspecified'],
    ['NO_REPLY.', 'unspecified'],
    ['NO_REPLY:duplicate', 'duplicate'],
    ['NO_REPLY: already_handled', 'already_handled'],
    ['[NO_REPLY:off_topic]', 'off_topic'],
    ['NO_REPLY：nothing_to_add', 'nothing_to_add'],
    ['NO_REPLY:not_addressed', 'not_addressed'],
    ['NO_REPLY:NOT_ADDRESSED', 'not_addressed'],
  ])('reads %j as the token with reason %s', (content, reason) => {
    expect(parseBotNoReplyToken(content)).toBe(reason);
  });

  it('collapses an unknown reason, and one the agent cannot claim, to unspecified', () => {
    expect(parseBotNoReplyToken('NO_REPLY:because')).toBe('unspecified');
    expect(parseBotNoReplyToken('NO_REPLY:empty_completion')).toBe('unspecified');
  });

  it.each([
    [undefined],
    [null],
    [''],
    ['  '],
    ['I will reply NO_REPLY when nothing is needed.'],
    ['NO_REPLY\n\nActually, here is the answer.'],
    ['The token is `NO_REPLY:duplicate`'],
    ['NO_REPLY:not addressed'],
  ])('does not treat %j as the token', (content) => {
    expect(parseBotNoReplyToken(content)).toBeUndefined();
  });
});
