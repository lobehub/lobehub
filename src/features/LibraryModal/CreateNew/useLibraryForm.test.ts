import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLibraryForm } from './useLibraryForm';

const mocks = vi.hoisted(() => ({
  createNewKnowledgeBase: vi.fn(),
  navigate: vi.fn(),
  setListVisibility: vi.fn(),
  toastError: vi.fn(),
  updateKnowledgeBase: vi.fn(),
  updateKnowledgeBaseCover: vi.fn(),
}));

let workspaceId: string | null = null;
let listVisibility: 'private' | 'workspace' = 'workspace';
let listVisibilityWorkspaceId: string | undefined;

vi.mock('@lobehub/ui', () => ({ toast: { error: mocks.toastError } }));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => workspaceId,
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

vi.mock('@/features/ResourceManager/store', () => ({
  useResourceManagerStore: (selector: (state: any) => unknown) =>
    selector({
      listVisibility,
      listVisibilityWorkspaceId,
      setListVisibility: mocks.setListVisibility,
    }),
}));

vi.mock('@/store/library', () => ({
  useKnowledgeBaseStore: (selector: (state: any) => unknown) =>
    selector({
      createNewKnowledgeBase: mocks.createNewKnowledgeBase,
      updateKnowledgeBase: mocks.updateKnowledgeBase,
      updateKnowledgeBaseCover: mocks.updateKnowledgeBaseCover,
    }),
}));

describe('useLibraryForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    workspaceId = null;
    listVisibility = 'workspace';
    listVisibilityWorkspaceId = undefined;
    mocks.createNewKnowledgeBase.mockResolvedValue('kb-1');
  });

  it('creates in the persisted private space even when the resource store was never hydrated', async () => {
    // ⌘K from a chat page: the store still holds the 'workspace' default, but
    // the user last chose Private for this workspace.
    workspaceId = 'ws-1';
    window.localStorage.setItem('lobehub:resource-mode:ws-1', 'private');
    const onSuccess = vi.fn();

    const { result } = renderHook(() => useLibraryForm({ onSuccess }));

    expect(result.current.showVisibility).toBe(true);
    expect(result.current.visibility).toBe('private');

    act(() => result.current.setName('Notes'));
    await act(() => result.current.submit());

    expect(mocks.createNewKnowledgeBase).toHaveBeenCalledWith(
      expect.objectContaining({
        cover: expect.any(String),
        description: '',
        name: 'Notes',
        visibility: 'private',
      }),
    );
    expect(onSuccess).toHaveBeenCalledWith('kb-1');
    // The sidebar follows the library into its space so it does not look lost.
    expect(mocks.setListVisibility).toHaveBeenCalledWith('private', 'ws-1');
  });

  it('keeps the active private space when its persisted record is missing or stale', async () => {
    // The toggle updates the store before a best-effort localStorage write; if
    // that write failed, the sidebar + entry must still default to Private.
    workspaceId = 'ws-1';
    listVisibility = 'private';
    listVisibilityWorkspaceId = 'ws-1';
    window.localStorage.setItem('lobehub:resource-mode:ws-1', 'workspace');

    const { result } = renderHook(() => useLibraryForm({ onSuccess: vi.fn() }));

    expect(result.current.visibility).toBe('private');
  });

  it('ignores a store space hydrated for another workspace', () => {
    workspaceId = 'ws-2';
    listVisibility = 'private';
    listVisibilityWorkspaceId = 'ws-1';

    const { result } = renderHook(() => useLibraryForm({}));

    expect(result.current.visibility).toBe('workspace');
  });

  it('creates a workspace library when the user picks the workspace space', async () => {
    workspaceId = 'ws-1';
    listVisibility = 'private';

    const { result } = renderHook(() =>
      useLibraryForm({ initialVisibility: 'private', onSuccess: vi.fn() }),
    );

    act(() => {
      result.current.setVisibility('workspace');
      result.current.setName('Team');
    });
    await act(() => result.current.submit());

    expect(mocks.createNewKnowledgeBase).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'public' }),
    );
    expect(mocks.setListVisibility).toHaveBeenCalledWith('workspace', 'ws-1');
  });

  it('hides visibility in personal mode and keeps creating public libraries', async () => {
    const { result } = renderHook(() => useLibraryForm({ onSuccess: vi.fn() }));

    expect(result.current.showVisibility).toBe(false);

    act(() => result.current.setName('Mine'));
    await act(() => result.current.submit());

    expect(mocks.createNewKnowledgeBase).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'public' }),
    );
    expect(mocks.setListVisibility).not.toHaveBeenCalled();
  });

  it('blocks a blank name and flags the field', async () => {
    const { result } = renderHook(() => useLibraryForm({}));

    expect(result.current.submitDisabled).toBe(true);

    act(() => result.current.setName('   '));
    await act(() => result.current.submit());

    expect(result.current.nameError).toBe(true);
    expect(mocks.createNewKnowledgeBase).not.toHaveBeenCalled();

    act(() => result.current.setName('Notes'));
    expect(result.current.nameError).toBe(false);
  });

  it('reports a failed create and keeps the modal and input', async () => {
    mocks.createNewKnowledgeBase.mockRejectedValue(new Error('network'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onClose = vi.fn();

    const { result } = renderHook(() => useLibraryForm({ onClose }));

    act(() => result.current.setName('Notes'));
    await act(() => result.current.submit());

    expect(mocks.toastError).toHaveBeenCalledWith('createNew.error');
    expect(onClose).not.toHaveBeenCalled();
    expect(result.current.name).toBe('Notes');
    expect(result.current.loading).toBe(false);
  });

  it('opens the new library in-app instead of reloading the page', async () => {
    const onClose = vi.fn();

    const { result } = renderHook(() => useLibraryForm({ onClose }));

    act(() => result.current.setName('Notes'));
    await act(() => result.current.submit());

    expect(mocks.navigate).toHaveBeenCalledWith('/resource/library/kb-1');
    expect(onClose).toHaveBeenCalled();
  });

  it('only saves edits that change something and never sends visibility', async () => {
    workspaceId = 'ws-1';
    const onClose = vi.fn();

    const { result } = renderHook(() =>
      useLibraryForm({ id: 'kb-1', initialValues: { description: 'old', name: 'Notes' }, onClose }),
    );

    expect(result.current.showVisibility).toBe(false);
    expect(result.current.submitDisabled).toBe(true);

    act(() => result.current.setName('Notes v2'));
    await act(() => result.current.submit());

    expect(mocks.updateKnowledgeBase).toHaveBeenCalledWith('kb-1', {
      description: 'old',
      name: 'Notes v2',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('saves a cover-only edit without rewriting the metadata as a no-op', async () => {
    const { result } = renderHook(() =>
      useLibraryForm({ id: 'kb-1', initialValues: { description: 'old', name: 'Notes' } }),
    );

    expect(result.current.submitDisabled).toBe(true);

    act(() => result.current.setCover('preset:ocean'));
    expect(result.current.submitDisabled).toBe(false);
    await act(() => result.current.submit());

    expect(mocks.updateKnowledgeBaseCover).toHaveBeenCalledWith('kb-1', 'preset:ocean');
  });
});
