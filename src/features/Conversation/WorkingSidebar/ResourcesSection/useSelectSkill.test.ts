import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { INSERT_ACTION_TAG_COMMAND } from '@/features/ChatInput/InputEditor/ActionTag/command';

import { useSelectSkill } from './useSelectSkill';

const mocks = vi.hoisted(() => ({
  editor: { dispatchCommand: vi.fn(), focus: vi.fn() },
  hasEditor: true,
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: unknown) => unknown) =>
    selector({ mainInputEditor: mocks.hasEditor ? { instance: mocks.editor } : null }),
}));

const item = { id: 'skill-id', name: 'Display name' };

describe('useSelectSkill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasEditor = true;
  });

  it.each([
    ['projectSkill', 'Display name'],
    ['skill', 'skill-id'],
  ] as const)('inserts a %s tag and focuses the composer', (category, type) => {
    const { result } = renderHook(() => useSelectSkill(category));

    act(() => result.current?.(item));

    expect(mocks.editor.focus).toHaveBeenCalledOnce();
    expect(mocks.editor.dispatchCommand).toHaveBeenCalledExactlyOnceWith(
      INSERT_ACTION_TAG_COMMAND,
      { category, label: item.name, skipIfExists: true, type },
    );
  });

  it('resolves agent skills by filename, not their display title or document id', () => {
    const { result } = renderHook(() => useSelectSkill('agentSkill', () => 'agent-skills:writing'));

    act(() => result.current?.(item));

    expect(mocks.editor.dispatchCommand).toHaveBeenCalledWith(INSERT_ACTION_TAG_COMMAND, {
      category: 'agentSkill',
      label: item.name,
      skipIfExists: true,
      type: 'agent-skills:writing',
    });
  });

  it('does not insert an unresolvable agent skill', () => {
    const { result } = renderHook(() => useSelectSkill('agentSkill', () => undefined));
    act(() => result.current?.(item));
    expect(mocks.editor.dispatchCommand).not.toHaveBeenCalled();
    expect(mocks.editor.focus).not.toHaveBeenCalled();
  });

  it('preserves browsing without a composer and enables selection when it mounts', () => {
    mocks.hasEditor = false;
    const { result, rerender } = renderHook(() => useSelectSkill('skill'));
    expect(result.current).toBeUndefined();

    mocks.hasEditor = true;
    rerender();
    act(() => result.current?.(item));
    expect(mocks.editor.dispatchCommand).toHaveBeenCalledOnce();

    mocks.hasEditor = false;
    rerender();
    expect(result.current).toBeUndefined();
  });
});
