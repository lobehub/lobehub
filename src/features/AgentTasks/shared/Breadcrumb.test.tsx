/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Breadcrumb from './Breadcrumb';

const mocks = vi.hoisted(() => ({
  agentMeta: undefined as any,
  params: {} as { aid?: string },
  taskState: {} as any,
}));

const createState = (taskDetailMap: Record<string, any>) => ({
  taskDetailMap,
});

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useParams: () => mocks.params,
}));

// Render the workspace-aware link as a plain anchor so the asserted hrefs stay
// the raw task paths (no workspace-slug prefix, no real router context).
vi.mock('@/features/Workspace/WorkspaceLink', () => ({
  default: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

vi.mock('./useAgentDisplayMeta', () => ({
  useAgentDisplayMeta: () => mocks.agentMeta,
}));

vi.mock('zustand/react/shallow', () => ({
  useShallow: (selector: any) => selector,
}));

vi.mock('@/store/task', () => ({
  useTaskStore: (selector: any) => selector(mocks.taskState),
}));

vi.mock('./style', () => ({
  styles: { breadcrumb: 'breadcrumb' },
}));

const renderAt = (ui: ReactNode, state?: unknown) =>
  render(<MemoryRouter initialEntries={[{ pathname: '/task/T-child', state }]}>{ui}</MemoryRouter>);

describe('Breadcrumb', () => {
  beforeEach(() => {
    mocks.agentMeta = undefined;
    mocks.params = {};
    mocks.taskState = createState({
      'T-child': {
        id: 'T-child',
        identifier: 'T-child',
        instruction: 'Child instruction',
        name: 'Child task',
        parent: {
          agentId: 'agt_parent',
          id: 'T-parent',
          identifier: 'T-parent',
          name: 'Parent task',
        },
        status: 'running',
      },
      'T-parent': {
        agentId: 'agt_parent',
        id: 'T-parent',
        identifier: 'T-parent',
        instruction: 'Parent instruction',
        name: 'Parent task',
        parent: { agentId: null, id: 'T-root', identifier: 'T-root', name: 'Root task' },
        status: 'running',
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('keeps the all-tasks root crumb on desktop', () => {
    renderAt(<Breadcrumb taskId="T-child" />);

    expect(screen.getByRole('link', { name: 'taskList.all' })).toHaveAttribute('href', '/tasks');
  });

  it('drops the all-tasks root crumb on mobile, where the back button leads up', () => {
    vi.stubGlobal('__MOBILE__', true);
    renderAt(<Breadcrumb taskId="T-child" />);

    expect(screen.queryByText('taskList.all')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'T-parent' })).toBeInTheDocument();
  });

  it('uses the ancestor owner agent when building breadcrumb links', () => {
    renderAt(<Breadcrumb taskId="T-child" />);

    expect(screen.getByRole('link', { name: 'T-parent' })).toHaveAttribute(
      'href',
      '/agent/agt_parent/task/T-parent/parent-task',
    );
    expect(screen.getByRole('link', { name: 'T-root' })).toHaveAttribute(
      'href',
      '/task/T-root/root-task',
    );
  });

  it('falls back to the global route when an ancestor owner is unknown', () => {
    mocks.taskState = createState({
      'T-child': {
        id: 'T-child',
        identifier: 'T-child',
        instruction: 'Child instruction',
        name: 'Child task',
        parent: { id: 'T-parent', identifier: 'T-parent', name: 'Parent task' },
        status: 'running',
      },
    });

    renderAt(<Breadcrumb taskId="T-child" />);

    expect(screen.getByRole('link', { name: 'T-parent' })).toHaveAttribute(
      'href',
      '/task/T-parent/parent-task',
    );
  });

  describe('returning to the source task list', () => {
    it('leads the all-tasks crumb back to the filtered list the detail was opened from', () => {
      renderAt(<Breadcrumb taskId="T-child" />, { taskListOrigin: '/tasks?collection=mine' });

      expect(screen.getByRole('link', { name: 'taskList.all' })).toHaveAttribute(
        'href',
        '/tasks?collection=mine',
      );
    });

    it('falls back to the bare list without a carried origin', () => {
      renderAt(<Breadcrumb taskId="T-child" />);

      expect(screen.getByRole('link', { name: 'taskList.all' })).toHaveAttribute('href', '/tasks');
    });

    it('keeps the agent list filters on the agent crumb only', () => {
      mocks.params = { aid: 'a1' };
      mocks.agentMeta = { backgroundColor: '', title: 'Agent One' };
      renderAt(<Breadcrumb taskId="T-child" />, {
        taskListOrigin: '/agent/a1/tasks?collection=mine&scope=created',
      });

      expect(screen.getByRole('link', { name: 'taskList.all' })).toHaveAttribute('href', '/tasks');
      expect(screen.getByRole('link', { name: 'Agent One' })).toHaveAttribute(
        'href',
        '/agent/a1/tasks?collection=mine&scope=created',
      );
    });
  });
});
