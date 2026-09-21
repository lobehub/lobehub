import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildMessagePatch } from './messagePatch';

const message = (id: string, content: string): UIChatMessage =>
  ({ content, createdAt: 1, id, role: 'assistant', updatedAt: 1 }) as UIChatMessage;

describe('buildMessagePatch', () => {
  it('emits only changed and appended rows with canonical anchors', () => {
    const before = [message('a', 'same'), message('b', 'old')];
    const after = [message('a', 'same'), message('b', 'new'), message('c', 'created')];

    expect(buildMessagePatch(before, after, 4)).toEqual({
      deletes: [],
      revision: 4,
      upserts: [
        { afterId: 'a', message: after[1] },
        { afterId: 'b', message: after[2] },
      ],
    });
  });

  it('emits deleted top-level envelopes', () => {
    expect(
      buildMessagePatch([message('a', 'a'), message('b', 'b')], [message('b', 'b')], 2),
    ).toEqual({
      deletes: ['a'],
      revision: 2,
      upserts: [],
    });
  });

  it('treats a changed nested envelope as one atomic upsert', () => {
    const before = [{ ...message('group', ''), compressedMessages: [message('a', 'old')] }];
    const after = [{ ...message('group', ''), compressedMessages: [message('a', 'new')] }];

    expect(buildMessagePatch(before, after, 1).upserts).toEqual([
      { afterId: null, message: after[0] },
    ]);
  });
});
