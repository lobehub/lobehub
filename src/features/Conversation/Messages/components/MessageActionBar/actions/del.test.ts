/**
 * @vitest-environment happy-dom
 */
import type { UIChatMessage } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MessageActionContext } from '../types';
import { delAction } from './del';

const deleteMessage = vi.fn();
const deleteDBMessage = vi.fn();

vi.mock('../../../../store', () => ({
  useConversationStore: (selector: (s: any) => any) => selector({ deleteMessage, deleteDBMessage }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const build = (
  data: Partial<UIChatMessage>,
  role: MessageActionContext['role'] = 'group',
  id = 'group-1',
) =>
  renderHook(() => delAction.useBuild({ data: data as UIChatMessage, id, role })).result.current!;

describe('delAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes only the errored tail step of a heterogeneous (CC/Codex) run', () => {
    const data = {
      id: 'group-1',
      role: 'assistantGroup',
      children: [
        { id: 'step-23', content: 'done' },
        {
          id: 'step-24',
          error: { body: { agentType: 'claude-code', code: 'overloaded' } },
        },
      ],
    } as unknown as UIChatMessage;

    build(data).handleClick!();

    // Must target the failed step's DB id (a child block), not the group id.
    expect(deleteDBMessage).toHaveBeenCalledWith('step-24');
    expect(deleteMessage).not.toHaveBeenCalled();
  });

  it('deletes the whole group when the tail error is NOT a heterogeneous-agent error', () => {
    // A normal grouped reply that merely ends in a generic tool/provider error
    // keeps the whole-group delete.
    const data = {
      id: 'group-1',
      role: 'assistantGroup',
      children: [
        { id: 'step-1', content: 'done' },
        { id: 'step-2', error: { type: 'PluginError', body: { message: 'boom' } } },
      ],
    } as unknown as UIChatMessage;

    build(data).handleClick!();

    expect(deleteMessage).toHaveBeenCalledWith('group-1');
    expect(deleteDBMessage).not.toHaveBeenCalled();
  });

  it('deletes the whole group when no step errored', () => {
    const data = {
      id: 'group-1',
      role: 'assistantGroup',
      children: [{ id: 'step-23', content: 'done' }],
    } as unknown as UIChatMessage;

    build(data).handleClick!();

    expect(deleteMessage).toHaveBeenCalledWith('group-1');
    expect(deleteDBMessage).not.toHaveBeenCalled();
  });

  it('deletes by message id for a non-group message', () => {
    build(
      { id: 'msg-1', role: 'assistant', content: 'hi' } as unknown as UIChatMessage,
      'assistant',
      'msg-1',
    ).handleClick!();

    expect(deleteMessage).toHaveBeenCalledWith('msg-1');
    expect(deleteDBMessage).not.toHaveBeenCalled();
  });
});
