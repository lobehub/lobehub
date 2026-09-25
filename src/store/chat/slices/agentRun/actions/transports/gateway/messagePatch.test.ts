import type { MessagePatchData } from '@lobechat/agent-gateway-client';
import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { applyMessagePatch } from './messagePatch';

const message = (id: string, content = id): UIChatMessage =>
  ({ content, createdAt: 1, id, role: 'assistant', updatedAt: 1 }) as UIChatMessage;

describe('applyMessagePatch', () => {
  it('updates, deletes, and inserts without replacing untouched history', () => {
    const patch: MessagePatchData = {
      deletes: ['b'],
      revision: 2,
      upserts: [
        { afterId: null, message: message('a', 'updated') },
        { afterId: 'a', message: message('c') },
      ],
    };

    expect(applyMessagePatch([message('a'), message('b')], patch)).toEqual([
      message('a', 'updated'),
      message('c'),
    ]);
  });

  it('fails closed when an insertion anchor is missing', () => {
    const patch: MessagePatchData = {
      deletes: [],
      revision: 1,
      upserts: [{ afterId: 'missing', message: message('new') }],
    };

    expect(applyMessagePatch([], patch)).toBeUndefined();
  });

  it('accepts an already-present row without requiring its anchor', () => {
    const patch: MessagePatchData = {
      deletes: [],
      revision: 1,
      upserts: [{ afterId: 'missing', message: message('a', 'settled') }],
    };

    expect(applyMessagePatch([message('a')], patch)).toEqual([message('a', 'settled')]);
  });
});
