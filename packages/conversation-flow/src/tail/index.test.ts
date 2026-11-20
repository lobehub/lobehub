import type { AssistantContentBlock } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { Message } from '../types';
import { findLatestWorkRootOperationId, getOperationFinalRootId, resolveConversationTail } from '.';

const at = (seconds: number) => 1_700_000_000_000 + seconds * 1000;

const message = (partial: Partial<Message> & Pick<Message, 'id' | 'role'>): Message =>
  ({
    content: '',
    createdAt: at(0),
    meta: {},
    updatedAt: at(0),
    ...partial,
  }) as Message;

describe('resolveConversationTail', () => {
  it('is single for a plain assistant reply', () => {
    const tail = resolveConversationTail([
      message({ content: 'hi', id: 'u1', role: 'user' }),
      message({ content: 'hello', createdAt: at(1), id: 'a1', parentId: 'u1', role: 'assistant' }),
    ]);

    expect(tail?.kind).toBe('single');
    expect(tail?.message.id).toBe('a1');
  });

  it('is group for an assistant turn that called tools', () => {
    const tail = resolveConversationTail([
      message({ content: 'hi', id: 'u1', role: 'user' }),
      message({
        createdAt: at(1),
        id: 'a1',
        parentId: 'u1',
        role: 'assistant',
        tools: [
          { apiName: 'search', arguments: '{}', id: 'call_1', identifier: 'web', type: 'builtin' },
        ],
      }),
      message({
        content: 'result',
        createdAt: at(2),
        id: 't1',
        parentId: 'a1',
        role: 'tool',
        tool_call_id: 'call_1',
      }),
      message({ content: 'done', createdAt: at(3), id: 'a2', parentId: 't1', role: 'assistant' }),
    ]);

    expect(tail?.kind).toBe('group');
    expect(tail?.message.children?.map((block) => block.id)).toEqual(['a1', 'a2']);
  });

  it('is undefined for an empty page', () => {
    expect(resolveConversationTail([])).toBeUndefined();
  });
});

describe('work root', () => {
  it('reads the stamped root operation id', () => {
    expect(getOperationFinalRootId({ work: { rootOperationId: 'op_1' } })).toBe('op_1');
    expect(getOperationFinalRootId({ work: { rootOperationId: 1 } })).toBeUndefined();
  });

  it('prefers the latest block stamp over the group metadata', () => {
    const blocks = [
      { content: '', id: 'b1', metadata: { work: { rootOperationId: 'op_old' } } },
      { content: '', id: 'b2', metadata: { work: { rootOperationId: 'op_new' } } },
    ] as AssistantContentBlock[];

    expect(findLatestWorkRootOperationId({ work: { rootOperationId: 'op_group' } }, blocks)).toBe(
      'op_new',
    );
    expect(findLatestWorkRootOperationId({ work: { rootOperationId: 'op_group' } }, [])).toBe(
      'op_group',
    );
  });
});
