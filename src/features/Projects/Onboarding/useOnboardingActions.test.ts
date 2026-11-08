import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProjectDetail } from '@/store/project';

import { useOnboardingActions, useOnboardingCardAllowed } from './useOnboardingActions';

const mocks = vi.hoisted(() => ({
  canManage: true,
  dismissed: false,
  navigate: vi.fn(),
  openAddDirectoryModal: vi.fn(),
  openSiteModal: vi.fn(),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (s: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: { projectOnboardingDismissed: () => () => mocks.dismissed },
}));
vi.mock('../useCanManageProject', () => ({ useCanManageProject: () => mocks.canManage }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));
vi.mock('../KnowledgeBases/AddKnowledgeBaseModal', () => ({ openAddKnowledgeBaseModal: vi.fn() }));
vi.mock('../Review/SiteFormModal', () => ({ openSiteModal: mocks.openSiteModal }));
vi.mock('../WorkingDirectories/AddDirectoryModal', () => ({
  openAddDirectoryModal: mocks.openAddDirectoryModal,
}));

const detail = {
  knowledgeBases: [],
  project: { id: 'prj_1', slug: 'launch', visibility: 'public', workspaceId: 'ws_1' },
} as unknown as ProjectDetail;

describe('useOnboardingCardAllowed', () => {
  beforeEach(() => {
    mocks.canManage = true;
    mocks.dismissed = false;
  });

  it('allows the card for someone who manages the project and has not dismissed it', () => {
    expect(renderHook(() => useOnboardingCardAllowed('prj_1')).result.current).toBe(true);
  });

  it.each([
    ['dismissed', () => (mocks.dismissed = true)],
    ['a viewer', () => (mocks.canManage = false)],
  ])('refuses the card when %s, so no checklist data is fetched', (_, arrange) => {
    arrange();
    expect(renderHook(() => useOnboardingCardAllowed('prj_1')).result.current).toBe(false);
  });
});

describe('useOnboardingActions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends Invite to the workspace member settings, where people are invited', () => {
    const { result } = renderHook(() => useOnboardingActions(detail, vi.fn()));
    result.current.inviteMembers();
    expect(mocks.navigate).toHaveBeenCalledWith('/settings/members');
  });

  it('opens the add-site dialog when there is no site, and the Sites tab once there is one', () => {
    const { result } = renderHook(() => useOnboardingActions(detail, vi.fn()));
    result.current.openConnection({ count: 0, done: false, key: 'site', site: 'none' });
    expect(mocks.openSiteModal).toHaveBeenCalledTimes(1);

    result.current.openConnection({ count: 1, done: false, key: 'site', site: 'waiting' });
    expect(mocks.navigate).toHaveBeenCalledWith('/project/launch/settings/sites');
  });

  it('opens the add-folder dialog until a folder is connected', () => {
    const { result } = renderHook(() => useOnboardingActions(detail, vi.fn()));
    result.current.openConnection({ count: 0, done: false, key: 'directory' });
    expect(mocks.openAddDirectoryModal).toHaveBeenCalledWith('prj_1');
  });
});
