/**
 * @vitest-environment happy-dom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CreateTaskInlineEntry from './CreateTaskInlineEntry';

const state = vi.hoisted(() => ({
  createTask: vi.fn(async () => ({ id: 't1', identifier: 'T-1' })),
  markdown: 'Ship it',
  projects: [{ id: 'p1', name: 'Apollo' }] as { id: string; name: string }[],
}));

vi.mock('@lobehub/editor/react', () => ({
  useEditor: () => EDITOR,
}));
const EDITOR = vi.hoisted(() => ({
  cleanDocument: () => {},
  getDocument: (type: string) => (type === 'markdown' ? state.markdown : {}),
  setDocument: () => {},
}));
vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  DropdownMenu: ({ items }: { items: { key: string; label: string; onClick: () => void }[] }) => (
    <>
      {items.map((item) => (
        <button key={item.key} onClick={item.onClick}>
          {item.label}
        </button>
      ))}
    </>
  ),
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => undefined,
}));
vi.mock('@/components/GeneratingBorder', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/features/AgentGoals/CreateGoalModal', () => ({ createGoalModal: vi.fn() }));
vi.mock('@/features/EditorCanvas', () => ({ EditorCanvas: () => null }));
vi.mock('@/features/EditorCanvas/editorAttachments', () => ({
  getAttachmentFileIdsFromEditor: () => [],
  pickAndInsertAttachments: vi.fn(),
}));
vi.mock('@/features/TaskLabels/TaskLabelChips', () => ({ default: () => null }));
vi.mock('@/features/TaskLabels/TaskLabelPicker', () => ({ default: () => null }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('@/services/task', () => ({ taskService: {} }));
vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (s: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/project', () => ({
  useLoadedProjectList: () => state.projects,
  useProjectStore: (selector: (s: unknown) => unknown) =>
    selector({ useFetchProjectList: () => ({ isValidating: false }) }),
}));
vi.mock('@/store/task', () => ({
  getTaskStoreState: () => ({ taskLabels: [], taskLabelsInit: true }),
  useTaskStore: (selector: (s: unknown) => unknown) => selector({ createTask: state.createTask }),
}));
vi.mock('@/store/task/selectors', () => ({
  taskLabelSelectors: { isLabelsInit: () => true, labels: () => [] },
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: { enableGoals: () => false, enableProjects: () => true },
  userProfileSelectors: { userId: () => 'u1' },
}));
vi.mock('@/styles', () => ({ shinyTextStyles: {} }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../features/AssigneeAgentSelector', () => ({ default: () => null }));
vi.mock('../features/AssigneeAvatar', () => ({ default: () => null }));
vi.mock('../features/AssigneeMemberSelector', () => ({ default: () => null }));
vi.mock('../features/AssigneeUserAvatar', () => ({ default: () => null }));
vi.mock('../features/TaskExecutionControls', () => ({ default: () => null }));
vi.mock('../features/TaskPriorityTag', () => ({ default: () => null }));
vi.mock('../features/TaskVisibilityChipLabel', () => ({ default: () => null }));
vi.mock('../features/TaskVisibilityTag', () => ({ default: () => null }));
vi.mock('../features/UnassignedAssigneeIcon', () => ({ UnassignedAssigneeIcon: () => null }));
vi.mock('../features/TaskProjectPickerChip', () => ({
  default: ({
    onChange,
    value,
  }: {
    onChange: (id: string | null) => void;
    value: string | null;
  }) => (
    <div>
      <span data-testid="chip">{value ?? 'empty'}</span>
      <button onClick={() => onChange('p1')}>pick</button>
      <button onClick={() => onChange(null)}>clear</button>
    </div>
  ),
}));
vi.mock('../shared/memberAssigneeMode', () => ({ resolveMemberAssignee: () => undefined }));
vi.mock('../shared/taskDetailPath', () => ({ taskDetailPath: () => '/' }));
vi.mock('../shared/useAgentDisplayMeta', () => ({ useAgentDisplayMeta: () => undefined }));
vi.mock('../shared/useAgentVisibility', () => ({ useAgentVisibility: () => undefined }));
vi.mock('../shared/useDefaultMemberAssignee', () => ({
  useDefaultMemberAssignee: () => ({
    assignableMemberIds: new Set(),
    isDefaultMemberPending: false,
    isMembersLoading: false,
  }),
}));
vi.mock('../shared/useUserDisplayMeta', () => ({ useUserDisplayMeta: () => undefined }));
vi.mock('./TaskIntentReview', () => ({ default: () => null }));

const ALL_KEY = 'lobehub:task-create-draft:personal:all';
const PROJECT_KEY = 'lobehub:task-create-draft:personal:p1';

const createDirectly = async () => {
  state.createTask.mockClear();
  fireEvent.click(screen.getByText('taskIntent.createDirectly'));
  await waitFor(() => expect(state.createTask).toHaveBeenCalledTimes(1));
  return (state.createTask.mock.calls as unknown as [[{ projectId?: string }]])[0][0];
};

const savedDraft = (key: string) => JSON.parse(localStorage.getItem(key) ?? '{}');

beforeEach(() => {
  localStorage.clear();
  state.markdown = 'Ship it';
  state.projects = [{ id: 'p1', name: 'Apollo' }];
});

describe('CreateTaskInlineEntry project', () => {
  it('creates without a project when none is picked', async () => {
    render(<CreateTaskInlineEntry />);
    expect(screen.getByTestId('chip')).toHaveTextContent('empty');
    expect((await createDirectly()).projectId).toBeUndefined();
  });

  it('creates in the picked project and goes back to empty', async () => {
    render(<CreateTaskInlineEntry />);
    fireEvent.click(screen.getByText('pick'));
    expect((await createDirectly()).projectId).toBe('p1');
    await waitFor(() => expect(screen.getByTestId('chip')).toHaveTextContent('empty'));
  });

  it('prefills the page project, returns to it after creating, and lets it be cleared', async () => {
    render(<CreateTaskInlineEntry projectId="p1" />);
    expect(screen.getByTestId('chip')).toHaveTextContent('p1');

    fireEvent.click(screen.getByText('clear'));
    expect((await createDirectly()).projectId).toBeUndefined();
    await waitFor(() => expect(screen.getByTestId('chip')).toHaveTextContent('p1'));
  });

  it('saves the pick in the draft and restores it after a reload', async () => {
    const first = render(<CreateTaskInlineEntry />);
    fireEvent.click(screen.getByText('pick'));
    await waitFor(() => expect(savedDraft(ALL_KEY).projectId).toBe('p1'));
    first.unmount();

    render(<CreateTaskInlineEntry />);
    expect(screen.getByTestId('chip')).toHaveTextContent('p1');
  });

  it('restores an explicit "no project" over the page default', async () => {
    const first = render(<CreateTaskInlineEntry projectId="p1" />);
    fireEvent.click(screen.getByText('clear'));
    await waitFor(() => expect(savedDraft(PROJECT_KEY).projectId).toBeNull());
    first.unmount();

    render(<CreateTaskInlineEntry projectId="p1" />);
    expect(screen.getByTestId('chip')).toHaveTextContent('empty');
  });

  it('keeps the default for a draft saved before projects could be picked', async () => {
    localStorage.setItem(PROJECT_KEY, JSON.stringify({ markdown: 'old', priority: 0 }));
    render(<CreateTaskInlineEntry projectId="p1" />);
    await act(async () => {});
    expect(screen.getByTestId('chip')).toHaveTextContent('p1');
  });

  it('ignores a malformed project in the draft', async () => {
    localStorage.setItem(ALL_KEY, JSON.stringify({ markdown: 'old', projectId: 42 }));
    render(<CreateTaskInlineEntry />);
    await act(async () => {});
    expect(screen.getByTestId('chip')).toHaveTextContent('empty');
  });

  it('drops a draft project that no longer exists', async () => {
    localStorage.setItem(ALL_KEY, JSON.stringify({ markdown: 'old', projectId: 'gone' }));
    render(<CreateTaskInlineEntry />);
    await waitFor(() => expect(screen.getByTestId('chip')).toHaveTextContent('empty'));
    expect((await createDirectly()).projectId).toBeUndefined();
  });

  it('has no picker on the subtask composer and leaves the project to the server', async () => {
    render(<CreateTaskInlineEntry parentTaskId="t-parent" />);
    expect(screen.queryByTestId('chip')).not.toBeInTheDocument();
    expect((await createDirectly()).projectId).toBeUndefined();
  });
});
