/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskNavBody } from './index';

const projectStore = vi.hoisted(() => ({
  fetch: {
    error: undefined as unknown,
    isHydrated: true,
    isValidating: false,
    revalidate: vi.fn(),
  },
  projects: undefined as { id: string; name: string }[] | undefined,
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => null,
}));
vi.mock('@/hooks/useActiveLocation', () => ({
  useActiveLocation: () => ({ pathname: '/tasks', search: '' }),
}));
vi.mock('@/store/project', () => ({
  useLoadedProjectList: () => projectStore.projects,
  useProjectStore: (selector: (state: object) => unknown) =>
    selector({ useFetchProjectList: () => projectStore.fetch }),
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: object) => unknown) => selector({}),
}));
vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: { enableGoals: () => false, enableProjects: () => true },
}));
vi.mock('@/features/HomeSidebar/Body/Project/ProjectItem', () => ({ projectIcon: () => null }));
vi.mock('@/features/MessageList', () => ({
  ListHeader: ({ title }: { title: string }) => createElement('div', {}, title),
}));
vi.mock('@/features/NavPanel/components/NavItem', () => ({
  default: ({ title }: { title: string }) => createElement('div', {}, title),
}));
vi.mock('@/features/NavPanel/components/SkeletonList', () => ({
  default: () => createElement('div', {}, 'Loading projects'),
}));
vi.mock('@/features/Workspace/WorkspaceLink', () => ({
  default: ({ children }: { children: React.ReactNode }) => createElement('div', {}, children),
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => () => {},
}));
vi.mock('@/components/AsyncError', () => ({
  default: ({ onRetry }: { onRetry?: () => void }) =>
    createElement('button', { onClick: onRetry, type: 'button' }, 'Retry projects'),
}));

beforeEach(() => {
  projectStore.fetch.error = undefined;
  projectStore.fetch.isHydrated = true;
  projectStore.fetch.isValidating = false;
  projectStore.fetch.revalidate.mockReset();
  projectStore.projects = undefined;
});

describe('TaskNavBody', () => {
  it('shows the skeleton while the first project load is in flight', () => {
    projectStore.fetch.isHydrated = false;

    render(createElement(TaskNavBody));

    expect(screen.getByText('Loading projects')).toBeInTheDocument();
  });

  it('shows a retryable error when the first project load fails', () => {
    projectStore.fetch.error = new Error('network');

    render(createElement(TaskNavBody));

    expect(screen.queryByText('Loading projects')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Retry projects'));
    expect(projectStore.fetch.revalidate).toHaveBeenCalled();
  });

  it('lists the projects once they load', () => {
    projectStore.projects = [{ id: 'p1', name: 'Alpha' }];

    render(createElement(TaskNavBody));

    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });

  it('shows the empty hint when the workspace has no project', () => {
    projectStore.projects = [];

    render(createElement(TaskNavBody));

    expect(screen.getByText('taskNav.noProjects')).toBeInTheDocument();
  });
});
