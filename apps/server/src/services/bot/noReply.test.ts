import { BOT_NO_REPLY_LABELS, BOT_NO_REPLY_REASONS } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { detectNoReply } from './noReply';

describe('detectNoReply', () => {
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
  ])('reads %j as silence for a followup wake (%s)', (content, reason) => {
    expect(detectNoReply({ content, wakeKind: 'followup' })).toEqual({ reason });
  });

  it('collapses an unknown reason, and one the agent cannot claim, to unspecified', () => {
    expect(detectNoReply({ content: 'NO_REPLY:because', wakeKind: 'followup' })).toEqual({
      reason: 'unspecified',
    });
    expect(detectNoReply({ content: 'NO_REPLY:empty_completion', wakeKind: 'followup' })).toEqual({
      reason: 'unspecified',
    });
  });

  it('treats a followup that produced nothing as an empty completion', () => {
    expect(detectNoReply({ content: '', wakeKind: 'followup' })).toEqual({
      reason: 'empty_completion',
    });
    expect(detectNoReply({ content: ' \n ', wakeKind: 'followup' })).toEqual({
      reason: 'empty_completion',
    });
    expect(detectNoReply({ wakeKind: 'followup' })).toEqual({ reason: 'empty_completion' });
  });

  it('does not treat an attachment-only followup reply as silence', () => {
    expect(detectNoReply({ content: '', hasAttachments: true, wakeKind: 'followup' })).toBe(
      undefined,
    );
  });

  it.each(['Sure, NO_REPLY is the token', 'NO_REPLY thanks for asking', 'I will say NO_REPLY'])(
    'does not mistake prose that mentions the token for silence: %j',
    (content) => {
      expect(detectNoReply({ content, wakeKind: 'followup' })).toBe(undefined);
    },
  );

  it('never reads a mention wake as silence, whatever the content', () => {
    for (const wakeKind of ['mention', undefined] as const) {
      expect(detectNoReply({ content: 'NO_REPLY', wakeKind })).toBe(undefined);
      expect(detectNoReply({ content: '', wakeKind })).toBe(undefined);
    }
  });

  it('labels every reason, as false_wake unless the message was already answered', () => {
    expect(Object.keys(BOT_NO_REPLY_LABELS).sort()).toEqual([...BOT_NO_REPLY_REASONS].sort());
    expect(BOT_NO_REPLY_LABELS.duplicate).toBe('dup_wake');
    expect(BOT_NO_REPLY_LABELS.already_handled).toBe('dup_wake');
    expect(BOT_NO_REPLY_LABELS.off_topic).toBe('false_wake');
    expect(BOT_NO_REPLY_LABELS.empty_completion).toBe('false_wake');
  });
});
