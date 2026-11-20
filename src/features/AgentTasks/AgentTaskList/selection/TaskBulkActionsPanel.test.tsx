import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTaskSelectionStore } from './store';
import TaskBulkActionsPanel from './TaskBulkActionsPanel';

const run = vi.fn();
const confirmModal = vi.fn();
const rememberAssignee = vi.fn();

const agent = (id: string, title: string) => ({
  avatar: null,
  description: null,
  id,
  pinned: false,
  title,
  type: 'agent' as const,
  updatedAt: new Date(),
});

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  confirmModal: (...args: unknown[]) => confirmModal(...args),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
  }),
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => 'ws_1',
}));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('@/components/AgentAvatar', () => ({ default: () => null }));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/user/selectors', () => ({ userProfileSelectors: { userId: () => 'me' } }));
vi.mock('../../features/useAssigneeAgentScopes', () => ({
  useAssigneeAgentScopes: () => ({
    inboxAgent: undefined,
    privateAgentIds: new Set(['agt_private']),
    recentIds: [],
    rememberAssignee,
    scopes: [
      {
        id: 'private',
        sections: [{ agents: [agent('agt_private', 'Secret')], collapsible: false, id: 'p' }],
        title: 'Private',
      },
      {
        id: 'workspace',
        sections: [
          {
            agents: [agent('agt_pinned', 'Nasa')],
            collapsible: false,
            id: 'workspace:pinned',
            title: 'Pinned',
          },
          {
            agents: [agent('agt_shared', 'Cook')],
            collapsible: true,
            id: 'grp_1',
            title: 'Kitchen',
          },
        ],
        title: 'Workspace',
      },
    ],
  }),
}));
vi.mock('./useTaskBatchActions', () => ({
  useTaskBatchActions: () => ({ run, running: false }),
}));

const tasks = [
  { createdByUserId: 'me', id: 'own', identifier: 'T-1', status: 'backlog', visibility: 'public' },
  {
    createdByUserId: 'other',
    id: 'theirs',
    identifier: 'T-2',
    status: 'backlog',
    visibility: 'public',
  },
  {
    createdByUserId: 'me',
    id: 'mine',
    identifier: 'T-3',
    status: 'backlog',
    visibility: 'private',
  },
] as never[];

const openAgentPage = () => {
  render(<TaskBulkActionsPanel tasks={tasks} onClose={vi.fn()} />);
  fireEvent.click(screen.getByText('taskList.bulk.assignAgent'));
};

beforeEach(() => {
  useTaskSelectionStore.getState().prune(new Set(['own', 'theirs', 'mine']));
  useTaskSelectionStore.getState().selectAll(['own', 'theirs', 'mine']);
});

afterEach(() => {
  useTaskSelectionStore.getState().clear();
  run.mockReset();
  confirmModal.mockReset();
  rememberAssignee.mockReset();
});

describe('TaskBulkActionsPanel · assign agent', () => {
  it('groups agents like the single-task picker', () => {
    openAgentPage();

    const headings = [...document.querySelectorAll('[cmdk-group-heading]')].map(
      (node) => node.textContent,
    );
    expect(headings).toEqual(['Private', 'Workspace · Pinned', 'Workspace · Kitchen']);
    const kitchen = screen.getByText('Workspace · Kitchen').closest('[cmdk-group]') as HTMLElement;
    expect(within(kitchen).getByText('Cook')).toBeTruthy();
  });

  it('assigns a workspace agent straight away', () => {
    openAgentPage();
    fireEvent.click(screen.getByText('Cook'));

    expect(confirmModal).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith({ kind: 'update', patch: { assigneeAgentId: 'agt_shared' } });
    expect(rememberAssignee).toHaveBeenCalledWith('agt_shared');
  });

  it('asks before making public tasks private for a private agent, then assigns them all', async () => {
    openAgentPage();
    fireEvent.click(screen.getByText('Secret'));

    expect(run).not.toHaveBeenCalled();
    expect(rememberAssignee).not.toHaveBeenCalled();
    expect(confirmModal).toHaveBeenCalledTimes(1);
    const [modal] = confirmModal.mock.calls[0] as [
      {
        content: React.ReactElement<{ count: number; takeOverCount: number }>;
        onOk: () => void;
        title: string;
      },
    ];
    expect(modal.title).toBe('taskList.bulk.assignPrivate.title:3');
    expect(modal.content.props).toEqual({ count: 2, takeOverCount: 1 });

    modal.onOk();

    expect(rememberAssignee).toHaveBeenCalledWith('agt_private');

    expect(run).toHaveBeenCalledWith(
      { kind: 'update', patch: { assigneeAgentId: 'agt_private' } },
      expect.objectContaining({ prepare: expect.any(Function) }),
    );
  });
});
