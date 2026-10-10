/**
 * @vitest-environment happy-dom
 */
import type { UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MessageActionContext } from '../types';
import { forkAction } from './fork';

const mocks = vi.hoisted(() => ({
  activeTopicId: 'tpc-source' as string | undefined,
  forkTopic: vi.fn(),
  isGroupSession: false,
  isThreadMode: false,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  toast: { warning: vi.fn() },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: unknown) => unknown) =>
    selector({ activeTopicId: mocks.activeTopicId, forkTopic: mocks.forkTopic }),
}));

vi.mock('@/store/session', () => ({
  useSessionStore: (selector: (s: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/session/selectors', () => ({
  sessionSelectors: { isCurrentSessionGroupSession: () => mocks.isGroupSession },
}));

vi.mock('../../../../store', () => ({
  useConversationStore: (selector: (s: unknown) => unknown) => selector({}),
  messageStateSelectors: { isThreadMode: () => mocks.isThreadMode },
}));

// A group's id IS its head child's id — the assistantGroup bubble is a virtual
// message built from the run's first assistant row. Fixtures mirror that.
const build = (
  data: Partial<UIChatMessage>,
  role: MessageActionContext['role'] = 'group',
  id = 'msg-head',
) =>
  renderHook(() => forkAction.useBuild({ data: data as UIChatMessage, id, role })).result.current;

describe('forkAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeTopicId = 'tpc-source';
    mocks.isGroupSession = false;
    mocks.isThreadMode = false;
  });

  it('anchors a multi-step group reply on its tail row, not the group head', async () => {
    // The verified shape: head assistant row → tool result → final text row.
    // Anchoring on the head (the group's own id) would cut the fork off before
    // the tool result and the answer the user actually selected.
    const data = {
      children: [
        { id: 'msg-head', tools: [{ result_msg_id: 'msg-tool-result' }] },
        { content: 'STUB TURN DONE', id: 'msg-final' },
      ],
      id: 'msg-head',
      role: 'assistantGroup',
    } as unknown as UIChatMessage;

    const action = build(data);
    await act(async () => {
      await action!.handleClick!();
    });

    expect(mocks.forkTopic).toHaveBeenCalledWith('msg-final');
  });

  it('anchors on the trailing tool result when the reply ends on a tool step', async () => {
    const data = {
      children: [
        { content: 'done', id: 'msg-head' },
        { id: 'msg-step2', tools: [{ result_msg_id: 'msg-tool-2' }] },
      ],
      id: 'msg-head',
      role: 'assistantGroup',
    } as unknown as UIChatMessage;

    const action = build(data);
    await act(async () => {
      await action!.handleClick!();
    });

    expect(mocks.forkTopic).toHaveBeenCalledWith('msg-tool-2');
  });

  it('forks a plain assistant message by its own id', async () => {
    const data = { content: 'hi', id: 'msg-1', role: 'assistant' } as unknown as UIChatMessage;

    const action = build(data, 'assistant', 'msg-1');
    await act(async () => {
      await action!.handleClick!();
    });

    expect(mocks.forkTopic).toHaveBeenCalledWith('msg-1');
  });

  it('is hidden inside a thread, where the copied rows would render nowhere', () => {
    mocks.isThreadMode = true;

    expect(build({ id: 'msg-1', role: 'assistant' } as unknown as UIChatMessage, 'assistant')).toBe(
      null,
    );
  });

  it('is hidden in an agent-group session, matching the context menu', () => {
    mocks.isGroupSession = true;

    expect(build({ id: 'msg-1', role: 'assistant' } as unknown as UIChatMessage, 'assistant')).toBe(
      null,
    );
  });

  it('is hidden for user messages', () => {
    expect(build({ id: 'msg-1', role: 'user' } as unknown as UIChatMessage, 'user')).toBeNull();
  });
});
