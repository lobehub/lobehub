import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGoalTitleEditor } from './useGoalTitleEditor';

const save = vi.fn();

const keyEvent = (key: string) => {
  const blur = vi.fn();
  return {
    blur,
    event: {
      currentTarget: { blur },
      key,
      nativeEvent: { isComposing: false },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as never,
  };
};

const renderEditor = (title = 'Old title') =>
  renderHook(({ current }) => useGoalTitleEditor(current, save), {
    initialProps: { current: title },
  });

describe('useGoalTitleEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    save.mockResolvedValue(undefined);
  });

  it('saves the trimmed title when the field loses focus', async () => {
    const { result } = renderEditor();

    act(() => result.current.setValue('  New title  '));
    await act(async () => result.current.onBlur());

    expect(save).toHaveBeenCalledWith('New title');
  });

  it('leaves the field on Enter, which saves through the blur', () => {
    const { result } = renderEditor();
    const { blur, event } = keyEvent('Enter');

    act(() => result.current.onKeyDown(event));

    expect(blur).toHaveBeenCalled();
  });

  it('puts the saved title back on Escape and skips the save its blur triggers', async () => {
    const { result } = renderEditor();
    const { blur, event } = keyEvent('Escape');

    act(() => result.current.setValue('Draft'));
    act(() => result.current.onKeyDown(event));
    await act(async () => result.current.onBlur());

    expect(blur).toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(result.current.value).toBe('Old title');

    // Only that one blur is skipped; the next edit saves again.
    act(() => result.current.setValue('Later'));
    await act(async () => result.current.onBlur());
    expect(save).toHaveBeenCalledWith('Later');
  });

  it('ignores Enter while an IME is composing', () => {
    const { result } = renderEditor();
    const { blur, event } = keyEvent('Enter');
    (event as { nativeEvent: { isComposing: boolean } }).nativeEvent.isComposing = true;

    act(() => result.current.onKeyDown(event));

    expect(blur).not.toHaveBeenCalled();
  });

  it('saves nothing for a blank or unchanged title', async () => {
    const { result } = renderEditor();

    act(() => result.current.setValue('   '));
    await act(async () => result.current.onBlur());
    expect(result.current.value).toBe('Old title');

    act(() => result.current.setValue('Old title'));
    await act(async () => result.current.onBlur());

    expect(save).not.toHaveBeenCalled();
  });

  it('shows the saved title again when the save is rejected', async () => {
    save.mockRejectedValue(new Error('forbidden'));
    const { result } = renderEditor();

    act(() => result.current.setValue('Nope'));
    await act(async () => result.current.onBlur());

    await waitFor(() => expect(result.current.value).toBe('Old title'));
  });

  it('follows a rename that lands from elsewhere', () => {
    const { rerender, result } = renderEditor();

    rerender({ current: 'Smart title' });

    expect(result.current.value).toBe('Smart title');
  });
});
