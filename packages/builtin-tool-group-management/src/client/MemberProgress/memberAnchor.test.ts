import { ThreadStatus, type UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { resolveMemberStatus, resolveMemberThreadId, selectMemberAnchors } from './memberAnchor';

const row = (message: Partial<UIChatMessage>) => message as UIChatMessage;

const messages = [
  row({ id: 'supervisor', role: 'assistant' }),
  row({ id: 'group-tool', parentId: 'supervisor', role: 'tool', tool_call_id: 'call_1' }),
  row({
    id: 'anchor-1',
    metadata: { groupMemberAnchor: { agentId: 'eng', index: 1 } },
    parentId: 'group-tool',
    role: 'tool',
    tool_call_id: 'call_1::m1',
  }),
  // Legacy anchor without the marker.
  row({ id: 'anchor-0', parentId: 'group-tool', role: 'tool', tool_call_id: 'call_1::m0' }),
  // The supervisor's continuation after the call resumes is not an anchor.
  row({ id: 'summary', parentId: 'group-tool', role: 'assistant' }),
];

describe('selectMemberAnchors', () => {
  it('keys marked and legacy anchors by task index', () => {
    const anchors = selectMemberAnchors(messages, 'call_1');

    expect(Object.keys(anchors)).toEqual(['0', '1']);
    expect(anchors[0].id).toBe('anchor-0');
    expect(anchors[1].id).toBe('anchor-1');
  });

  it('returns nothing for a call the server did not fan out', () => {
    expect(selectMemberAnchors(messages, 'call_other')).toEqual({});
    expect(selectMemberAnchors(messages, undefined)).toEqual({});
  });
});

describe('resolveMemberStatus', () => {
  it('treats a fresh anchor as running', () => {
    expect(resolveMemberStatus(row({ pluginState: { status: 'pending' } }))).toBe(
      ThreadStatus.Processing,
    );
  });

  it('follows the polled thread while the anchor is still pending', () => {
    const anchor = row({
      pluginState: { status: 'pending' },
      taskDetail: { status: ThreadStatus.Completed, threadId: 'thd_1' },
    });

    expect(resolveMemberStatus(anchor)).toBe(ThreadStatus.Completed);
  });

  it('lets the backfilled anchor outcome win', () => {
    const anchor = row({
      pluginState: { status: 'error', threadId: 'thd_1' },
      taskDetail: { status: ThreadStatus.Processing, threadId: 'thd_1' },
    });

    expect(resolveMemberStatus(anchor)).toBe(ThreadStatus.Failed);
    expect(resolveMemberStatus(row({ pluginState: { status: 'completed' } }))).toBe(
      ThreadStatus.Completed,
    );
  });
});

describe('resolveMemberThreadId', () => {
  it('reads the thread from polling first, then from the backfill', () => {
    expect(
      resolveMemberThreadId(
        row({
          pluginState: { threadId: 'thd_b' },
          taskDetail: { status: ThreadStatus.Processing, threadId: 'thd_a' },
        }),
      ),
    ).toBe('thd_a');
    expect(resolveMemberThreadId(row({ pluginState: { threadId: 'thd_b' } }))).toBe('thd_b');
    expect(resolveMemberThreadId(row({}))).toBeUndefined();
  });
});
