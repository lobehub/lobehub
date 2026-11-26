import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TopicListScopeContext } from '../../TopicListScope';
import { useRenameTopic } from './useRenameTopic';

const mocks = vi.hoisted(() => ({
  allowed: true,
  autoRenameTopicTitle: vi.fn(),
  openRenameModal: vi.fn(),
  refreshProjectTopics: vi.fn(),
  toastError: vi.fn(),
  updateTopicTitle: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({ toast: { error: mocks.toastError } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/RenameModal', () => ({ openRenameModal: mocks.openRenameModal }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: mocks.allowed }) }));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: object) => unknown) =>
    selector({
      autoRenameTopicTitle: mocks.autoRenameTopicTitle,
      updateTopicTitle: mocks.updateTopicTitle,
    }),
}));
vi.mock('@/store/projectWorkingDirectory', () => ({
  useProjectDirectoryStore: {
    getState: () => ({ refreshProjectTopics: mocks.refreshProjectTopics }),
  },
}));

const projectWrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    TopicListScopeContext.Provider,
    { value: { projectId: 'proj_1' } as never },
    children,
  );

/** Opens the modal through the hook and saves `newTitle` through its `onSave`. */
const renameTo = async (newTitle: string, wrapper?: typeof projectWrapper) => {
  const { result } = renderHook(() => useRenameTopic('tpc_1', 'Old'), { wrapper });
  act(() => result.current.openRename());
  const { onSave } = mocks.openRenameModal.mock.calls[0][0];
  await onSave(newTitle);
};

describe('useRenameTopic', () => {
  beforeEach(() => {
    mocks.allowed = true;
    vi.clearAllMocks();
  });

  it('saves the new title without refreshing a project outside a project scope', async () => {
    await renameTo('New');

    expect(mocks.openRenameModal).toHaveBeenCalledWith(
      expect.objectContaining({ defaultValue: 'Old' }),
    );
    expect(mocks.updateTopicTitle).toHaveBeenCalledWith('tpc_1', 'New');
    expect(mocks.refreshProjectTopics).not.toHaveBeenCalled();
  });

  it('refreshes the project topics inside a project scope', async () => {
    await renameTo('New', projectWrapper);

    expect(mocks.refreshProjectTopics).toHaveBeenCalledWith('proj_1');
  });

  it('tells a non-creator that only the creator can rename', async () => {
    mocks.updateTopicTitle.mockRejectedValueOnce({ data: { code: 'FORBIDDEN' } });

    await renameTo('New');

    expect(mocks.toastError).toHaveBeenCalledWith('manageOnlyCreator');
  });

  it('generates a title with the topic agent and refreshes the project', async () => {
    const { result } = renderHook(() => useRenameTopic('tpc_1', 'Old', 'agt_1'), {
      wrapper: projectWrapper,
    });

    await act(() => result.current.autoRename());

    expect(mocks.autoRenameTopicTitle).toHaveBeenCalledWith('tpc_1', 'agt_1');
    expect(mocks.refreshProjectTopics).toHaveBeenCalledWith('proj_1');
  });

  it('opens nothing without edit permission', () => {
    mocks.allowed = false;
    const { result } = renderHook(() => useRenameTopic('tpc_1', 'Old'));

    act(() => result.current.openRename());

    expect(result.current.canRename).toBe(false);
    expect(mocks.openRenameModal).not.toHaveBeenCalled();
  });
});
