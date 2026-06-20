/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Breadcrumb from './Breadcrumb';

const mocks = vi.hoisted(() => ({
  taskState: {} as any,
}));

const createState = (taskDetailMap: Record<string, any>) => ({
  taskDetailMap,
});

vi.mock('@lobehub/ui', () => ({
  Icon: () => <span>icon</span>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('antd', () => ({
  Breadcrumb: ({ items }: { items: Array<{ key?: string; title: ReactNode }> }) => (
    <nav>
      {items.map((item, index) => (
        <span data-testid="crumb" key={item.key ?? index}>
          {item.title}
        </span>
      ))}
    </nav>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  useParams: () => ({}),
}));

// Render the workspace-aware link as a plain anchor so the asserted hrefs stay
// the raw task paths (no workspace-slug prefix, no real router context).
vi.mock('@/features/Workspace/WorkspaceLink', () => ({
  default: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

// Agent crumb metadata isn't under test here; the agent store isn't mocked.
vi.mock('./useAgentDisplayMeta', () => ({
  useAgentDisplayMeta: () => undefined,
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

describe('Breadcrumb', () => {
  beforeEach(() => {
    mocks.taskState = createState({
      'T-child': {
        identifier: 'T-child',
        instruction: 'Child instruction',
        name: 'Child task',
        parent: { agentId: 'agt_parent', identifier: 'T-parent', name: 'Parent task' },
        status: 'running',
      },
      'T-parent': {
        agentId: 'agt_parent',
        identifier: 'T-parent',
        instruction: 'Parent instruction',
        name: 'Parent task',
        parent: { agentId: null, identifier: 'T-root', name: 'Root task' },
        status: 'running',
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('uses the ancestor owner agent when building breadcrumb links', () => {
    render(<Breadcrumb taskId="T-child" />);

    expect(screen.getByRole('link', { name: 'T-parent' })).toHaveAttribute(
      'href',
      '/agent/agt_parent/task/T-parent',
    );
    expect(screen.getByRole('link', { name: 'T-root' })).toHaveAttribute('href', '/task/T-root');
  });

  it('falls back to the global route when an ancestor owner is unknown', () => {
    mocks.taskState = createState({
      'T-child': {
        identifier: 'T-child',
        instruction: 'Child instruction',
        name: 'Child task',
        parent: { identifier: 'T-parent', name: 'Parent task' },
        status: 'running',
      },
    });

    render(<Breadcrumb taskId="T-child" />);

    expect(screen.getByRole('link', { name: 'T-parent' })).toHaveAttribute(
      'href',
      '/task/T-parent',
    );
  });
});
