/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDropdownMenu } from './useDropdownMenu';

const mocks = vi.hoisted(() => ({
  activeWorkspaceId: 'workspace-1' as string | undefined,
  canEdit: true,
  canManage: false,
  currentUserId: 'user-current',
  openEditor: vi.fn(),
  transferItems: [
    { key: 'transfer-knowledge-base', label: 'Move to…' },
    { key: 'copy-knowledge-base', label: 'Copy to…' },
  ],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@lobehub/ui', () => ({
  Icon: () => null,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  confirmModal: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => mocks.activeWorkspaceId,
}));

vi.mock('@/business/client/hooks/useKnowledgeBaseTransferMenuItem', () => ({
  useKnowledgeBaseTransferMenuItem: () => mocks.transferItems,
}));

vi.mock('@/features/LibraryModal', () => ({
  useCreateNewModal: () => ({ open: mocks.openEditor }),
}));

vi.mock('@/features/VisibilityConfirmContent', () => ({
  default: () => null,
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: mocks.canEdit }),
}));

vi.mock('@/hooks/useResourceManageable', () => ({
  useResourceManageable: () => mocks.canManage,
}));

vi.mock('@/store/library', () => ({
  useKnowledgeBaseStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      publishKnowledgeBaseToWorkspace: vi.fn(),
      removeKnowledgeBase: vi.fn(),
      setKnowledgeBaseVisibility: vi.fn(),
    }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ user: { id: mocks.currentUserId } }),
}));

vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: {
    userId: (state: { user?: { id?: string } }) => state.user?.id,
  },
}));

interface MenuItem {
  disabled?: boolean;
  key?: string;
  type?: 'divider';
}

const getItems = (permissionManageable = false) => {
  const { result } = renderHook(() =>
    useDropdownMenu({
      id: 'kb-1',
      name: 'Shared library',
      permissionManageable,
      toggleEditing: vi.fn(),
      userId: 'user-creator',
      visibility: 'public',
    }),
  );

  return result.current() as MenuItem[];
};

const getKeys = (items: MenuItem[]) => items.flatMap((item) => (item.key ? [item.key] : []));
const getMenuStructure = (items: MenuItem[]) =>
  items.flatMap((item) => item.key ?? item.type ?? []);

describe('Knowledge base list item dropdown menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeWorkspaceId = 'workspace-1';
    mocks.canEdit = true;
    mocks.canManage = false;
    mocks.currentUserId = 'user-current';
  });

  it('lets workspace members rename and edit a shared knowledge base', () => {
    const items = getItems();

    expect(getKeys(items)).toEqual(['rename', 'editDescription']);
    expect(items.filter((item) => item.key).every((item) => item.disabled !== true)).toBe(true);
  });

  it('omits unavailable ownership actions instead of disabling them', () => {
    const items = getItems(true);

    expect(getKeys(items)).toEqual(['rename', 'editDescription', 'member-permissions']);
    expect(getMenuStructure(items)).toEqual([
      'rename',
      'editDescription',
      'divider',
      'member-permissions',
    ]);
    expect(getKeys(items)).not.toEqual(
      expect.arrayContaining(['transfer-knowledge-base', 'copy-knowledge-base', 'delete']),
    );
  });

  it('keeps ownership actions available to the creator or workspace owner', () => {
    mocks.canManage = true;

    const items = getItems(true);

    expect(getKeys(items)).toEqual([
      'rename',
      'editDescription',
      'member-permissions',
      'transfer-knowledge-base',
      'copy-knowledge-base',
      'delete',
    ]);
    expect(getMenuStructure(items)).toEqual([
      'rename',
      'editDescription',
      'divider',
      'member-permissions',
      'divider',
      'transfer-knowledge-base',
      'copy-knowledge-base',
      'divider',
      'delete',
    ]);
    expect(items.filter((item) => item.key).every((item) => item.disabled !== true)).toBe(true);
  });

  it('groups visibility and member permission actions together', () => {
    mocks.canManage = true;
    mocks.currentUserId = 'user-creator';

    expect(getMenuStructure(getItems(true))).toEqual([
      'rename',
      'editDescription',
      'divider',
      'makePrivate',
      'member-permissions',
      'divider',
      'transfer-knowledge-base',
      'copy-knowledge-base',
      'divider',
      'delete',
    ]);
  });

  it('still separates move/copy when there is no member permission entry', () => {
    mocks.canManage = true;

    expect(getMenuStructure(getItems())).toEqual([
      'rename',
      'editDescription',
      'divider',
      'transfer-knowledge-base',
      'copy-knowledge-base',
      'divider',
      'delete',
    ]);
  });

  it('never opens or closes the menu with a divider', () => {
    mocks.canEdit = false;
    mocks.canManage = true;

    const items = getItems(true);

    expect(getMenuStructure(items)).toEqual(['member-permissions']);
  });

  it('omits rename and edit when the workspace role cannot edit content', () => {
    mocks.canEdit = false;

    expect(getKeys(getItems())).toEqual([]);
  });
});
