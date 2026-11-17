/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import CreateTaskContent from './CreateTaskContent';

const state = vi.hoisted(() => ({
  createTask: vi.fn(async () => ({ id: 't1', identifier: 'T-1' })),
}));

vi.mock('@lobehub/editor/react', () => ({
  useEditor: () => ({ getDocument: () => '' }),
}));
vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useModalContext: () => ({ close: vi.fn() }),
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => undefined,
}));
vi.mock('@/features/EditorCanvas', () => ({ EditorCanvas: () => null }));
vi.mock('@/features/EditorCanvas/editorAttachments', () => ({
  getAttachmentFileIdsFromEditor: () => [],
  pickAndInsertAttachments: vi.fn(),
}));
vi.mock('@/features/EditorCanvas/releaseEditorSelection', () => ({
  releaseEditorSelection: vi.fn(),
}));
vi.mock('@/features/TaskLabels/TaskLabelChips', () => ({ default: () => null }));
vi.mock('@/features/TaskLabels/TaskLabelPicker', () => ({ default: () => null }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (s: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/project', () => ({
  useLoadedProjectList: () => [{ id: 'p1', name: 'Apollo' }],
  useProjectStore: (selector: (s: unknown) => unknown) =>
    selector({ useFetchProjectList: () => ({ isValidating: false }) }),
}));
vi.mock('@/store/task', () => ({
  getTaskStoreState: () => ({ taskLabels: [], taskLabelsInit: true }),
  useTaskStore: (selector: (s: unknown) => unknown) =>
    selector({ createTask: state.createTask, taskLabels: [], taskLabelsInit: true }),
}));
vi.mock('@/store/task/selectors', () => ({
  taskLabelSelectors: { isLabelsInit: () => true, labels: () => [] },
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: { enableProjects: () => true },
  userProfileSelectors: { userId: () => 'u1' },
}));
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
vi.mock('../shared/memberAssigneeMode', () => ({
  resolveMemberAssignee: () => undefined,
}));
vi.mock('../shared/useAgentDisplayMeta', () => ({ useAgentDisplayMeta: () => undefined }));
vi.mock('../shared/useAgentVisibility', () => ({ useAgentVisibility: () => undefined }));
vi.mock('../shared/useDefaultMemberAssignee', () => ({
  useDefaultMemberAssignee: () => ({ isDefaultMemberPending: false }),
}));
vi.mock('../shared/useEscapeDiscardGuard', () => ({ useEscapeDiscardGuard: vi.fn() }));
vi.mock('../shared/useUserDisplayMeta', () => ({ useUserDisplayMeta: () => undefined }));

const submit = async () => {
  fireEvent.change(screen.getByPlaceholderText('createTask.titlePlaceholder'), {
    target: { value: 'Ship it' },
  });
  state.createTask.mockClear();
  fireEvent.click(screen.getByText('createTask.submit'));
  await waitFor(() => expect(state.createTask).toHaveBeenCalledTimes(1));
  return (state.createTask.mock.calls as unknown as [[{ projectId?: string }]])[0][0];
};

describe('CreateTaskContent project', () => {
  it('creates without a project when none is picked', async () => {
    render(<CreateTaskContent />);
    expect(screen.getByTestId('chip')).toHaveTextContent('empty');
    expect((await submit()).projectId).toBeUndefined();
  });

  it('creates in the picked project', async () => {
    render(<CreateTaskContent />);
    fireEvent.click(screen.getByText('pick'));
    expect(screen.getByTestId('chip')).toHaveTextContent('p1');
    expect((await submit()).projectId).toBe('p1');
  });

  it('prefills the page project', async () => {
    render(<CreateTaskContent projectId="p1" />);
    expect(screen.getByTestId('chip')).toHaveTextContent('p1');
    expect((await submit()).projectId).toBe('p1');
  });

  it('lets the prefill be cleared', async () => {
    render(<CreateTaskContent projectId="p1" />);
    fireEvent.click(screen.getByText('clear'));
    expect((await submit()).projectId).toBeUndefined();
  });
});
