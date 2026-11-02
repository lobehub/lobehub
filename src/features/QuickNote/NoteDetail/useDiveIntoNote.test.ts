import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDiveIntoNote } from './useDiveIntoNote';

const mocks = vi.hoisted(() => ({
  diveInto: vi.fn<(id: string) => Promise<string | undefined>>(),
  navigate: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({ toast: { error: mocks.toastError } }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

vi.mock('@/store/quickNote', () => ({
  useQuickNoteStore: (selector: (s: { diveInto: typeof mocks.diveInto }) => unknown) =>
    selector({ diveInto: mocks.diveInto }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('useDiveIntoNote', () => {
  /** @example A Dive opens the Task the server created. */
  it('navigates to the created task', async () => {
    mocks.diveInto.mockResolvedValue('task-1');
    const { result } = renderHook(() => useDiveIntoNote('note-1'));

    await act(() => result.current());

    expect(mocks.diveInto).toHaveBeenCalledWith('note-1');
    expect(mocks.navigate).toHaveBeenCalledWith('/task/task-1');
  });

  /** @example An ignored Dive (empty note, already running, failed save) stays on the note. */
  it('stays on the note when nothing was started', async () => {
    mocks.diveInto.mockResolvedValue(undefined);
    const { result } = renderHook(() => useDiveIntoNote('note-1'));

    await act(() => result.current());

    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  /** @example A failed request explains itself instead of failing silently. */
  it('shows a toast when the dive fails', async () => {
    mocks.diveInto.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useDiveIntoNote('note-1'));

    await act(() => result.current());

    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith('dive.failed');
  });
});
