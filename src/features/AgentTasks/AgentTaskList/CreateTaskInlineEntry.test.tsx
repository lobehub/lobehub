/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CSSProperties, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CreateTaskInlineEntry from './CreateTaskInlineEntry';

const permissionMock = vi.hoisted(() => ({
  allowed: true,
}));

const focusMock = vi.hoisted(() => vi.fn());
const createTaskMock = vi.hoisted(() => vi.fn());
const insertNewlineMock = vi.hoisted(() => vi.fn());
const editorMarkdownMock = vi.hoisted(() => ({ value: '' }));
const editorJsonMock = vi.hoisted(() => ({ value: {} as unknown }));
const analyzeIntentMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const createGoalModalMock = vi.hoisted(() => vi.fn());
const activeWorkspaceMock = vi.hoisted(() => ({
  id: 'workspace-1' as string | undefined,
}));
const workspaceMembersMock = vi.hoisted(() => ({
  isLoading: false,
  members: [{ role: 'member', userId: 'user-1' }],
}));

vi.mock('@lobehub/editor/react', () => ({
  useEditor: () => ({
    cleanDocument: vi.fn(),
    focus: focusMock,
    getDocument: (format: string) =>
      format === 'markdown' ? editorMarkdownMock.value : editorJsonMock.value,
    getLexicalEditor: () => undefined,
  }),
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { error: vi.fn(), success: toastSuccessMock },
}));

vi.mock('@/features/EditorCanvas', () => ({
  EditorCanvas: ({ disabled, style }: { disabled?: boolean; style?: CSSProperties }) => (
    <textarea
      data-disabled={String(!!disabled)}
      data-padding-bottom={String(style?.paddingBottom)}
      data-testid="task-editor"
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.defaultPrevented) insertNewlineMock();
      }}
    />
  ),
}));

vi.mock('@/services/task', () => ({
  taskService: { analyzeIntent: analyzeIntentMock },
}));

vi.mock('@/features/AgentGoals/CreateGoalModal', () => ({
  createGoalModal: createGoalModalMock,
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigateMock,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({
    allowed: permissionMock.allowed,
    reason: permissionMock.allowed ? '' : 'requires member',
  }),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => activeWorkspaceMock.id,
}));

vi.mock('@/business/client/hooks/useFetchWorkspaceMembers', () => ({
  useFetchWorkspaceMembers: () => ({ isLoading: workspaceMembersMock.isLoading }),
}));

vi.mock('@/business/client/hooks/useWorkspaceMembers', () => ({
  useWorkspaceMembers: () => workspaceMembersMock.members,
}));

vi.mock('@/store/task', () => ({
  useTaskStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      createTask: createTaskMock,
      isCreatingTask: false,
    }),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      updateSystemStatus: vi.fn(),
    }),
}));

const userStateMock = vi.hoisted(() => ({
  lab: {} as Record<string, boolean>,
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ preference: { lab: userStateMock.lab }, user: { id: 'self-user' } }),
}));

vi.mock('../features/TaskPriorityTag', () => ({
  default: ({ children }: { children?: ReactNode }) => (
    <div data-testid="priority">{children ?? 'priority'}</div>
  ),
}));

vi.mock('../features/AssigneeAgentSelector', () => ({
  default: ({
    children,
    currentAgentId,
    onChange,
  }: {
    children: ReactNode;
    currentAgentId?: string;
    onChange?: (id: string) => void;
  }) => (
    <div data-current-agent-id={currentAgentId ?? ''} data-testid="agent-selector">
      {children}
      <span data-testid="select-agent" onClick={() => onChange?.('agent-1')} />
    </div>
  ),
}));

vi.mock('../features/AssigneeMemberSelector', () => ({
  default: ({
    children,
    currentUserId,
    onChange,
  }: {
    children: ReactNode;
    currentUserId?: string;
    onChange?: (id: string) => void;
  }) => (
    <div data-current-user-id={currentUserId ?? ''} data-testid="member-selector">
      {children}
      <span data-testid="select-member" onClick={() => onChange?.('user-1')} />
    </div>
  ),
}));

vi.mock('../features/AssigneeAvatar', () => ({
  default: () => <div />,
}));

vi.mock('../features/AssigneeUserAvatar', () => ({
  default: () => <div />,
}));

vi.mock('../shared/useUserDisplayMeta', () => ({
  useUserDisplayMeta: () => undefined,
}));

vi.mock('../features/TaskVisibilityTag', () => ({
  default: ({
    children,
    lockedReason,
    visibility,
  }: {
    children?: ReactNode;
    lockedReason?: string;
    visibility: 'private' | 'public';
  }) => (
    <button
      data-locked={String(Boolean(lockedReason))}
      data-testid="visibility-trigger"
      data-visibility={visibility}
    >
      {children}
    </button>
  ),
}));

vi.mock('../shared/useAgentDisplayMeta', () => ({
  useAgentDisplayMeta: () => undefined,
}));

vi.mock('../shared/useAgentVisibility', () => ({
  useAgentVisibility: (agentId?: string) => (agentId === 'agent-private' ? 'private' : undefined),
}));

/** Flips the Labs toggles the composer still reads. */
const setLabs = (lab: { enableTopicAcceptance?: boolean }) => {
  userStateMock.lab = lab as Record<string, boolean>;
};

const clearReading = {
  clarifications: [],
  confidence: 'high' as const,
  kind: 'task' as const,
  refinedInstruction: 'Write a project plan for Q3.',
  summary: 'You want a project plan.',
  title: 'Write the Q3 project plan',
};

describe('CreateTaskInlineEntry', () => {
  beforeEach(() => {
    permissionMock.allowed = true;
    setLabs({});
    analyzeIntentMock.mockReset();
    navigateMock.mockReset();
    toastSuccessMock.mockReset();
    createGoalModalMock.mockReset();
    activeWorkspaceMock.id = 'workspace-1';
    workspaceMembersMock.isLoading = false;
    workspaceMembersMock.members = [{ role: 'member', userId: 'user-1' }];
    focusMock.mockReset();
    createTaskMock.mockReset();
    createTaskMock.mockResolvedValue({ identifier: 'task-1' });
    editorMarkdownMock.value = '';
    editorJsonMock.value = {};
    insertNewlineMock.mockReset();
    localStorage.clear();
  });

  it('renders the task editor as disabled when the user cannot create content', () => {
    permissionMock.allowed = false;

    render(<CreateTaskInlineEntry variant="hero" />);

    expect(screen.getByTestId('task-editor')).toHaveAttribute('data-disabled', 'true');
    expect(focusMock).not.toHaveBeenCalled();
  });

  it('clears the private-agent visibility lock when switching to the all-tasks create form', () => {
    const { rerender } = render(
      <CreateTaskInlineEntry lockAssignee agentId="agent-private" variant="hero" />,
    );

    expect(screen.getByTestId('visibility-trigger')).toHaveAttribute('data-locked', 'true');

    rerender(<CreateTaskInlineEntry variant="hero" />);

    expect(screen.getByTestId('visibility-trigger')).toHaveAttribute('data-locked', 'false');
  });

  it('uses compact editor padding and aligned action controls', () => {
    const { container } = render(<CreateTaskInlineEntry variant="hero" />);

    const editor = screen.getByTestId('task-editor');
    expect(editor.parentElement).toHaveStyle({ padding: '12px 16px 0' });
    expect(editor).toHaveAttribute('data-padding-bottom', '12');

    const assigneeControl = screen.getByText('createTask.assignee').parentElement;
    expect(assigneeControl?.style.getPropertyValue('--lobe-flex-height')).toBe('24px');
    expect(assigneeControl?.style.getPropertyValue('--lobe-flex-padding-block')).toBe('3px');

    const attachmentAction = container
      .querySelector('svg.lucide-paperclip')
      ?.closest<HTMLElement>('button');
    expect(attachmentAction).toHaveStyle({ height: '24px', width: '24px' });
    expect(attachmentAction?.parentElement?.style.getPropertyValue('--lobe-flex-align')).toBe(
      'center',
    );

    const visibilityTrigger = screen.getByTestId('visibility-trigger');
    expect(visibilityTrigger.nextElementSibling).toHaveTextContent('createTask.submit');
  });

  it('captures Cmd+Enter before the editor inserts a newline and submits the task', async () => {
    editorMarkdownMock.value = 'Write a project plan';
    analyzeIntentMock.mockResolvedValue(clearReading);

    render(<CreateTaskInlineEntry variant="hero" />);

    fireEvent.keyDown(screen.getByTestId('task-editor'), { key: 'Enter', metaKey: true });

    expect(insertNewlineMock).not.toHaveBeenCalled();
    await waitFor(() => expect(createTaskMock).toHaveBeenCalledTimes(1));
  });

  it('submits agent and member assignments together', async () => {
    editorMarkdownMock.value = 'Coordinate the release';
    render(<CreateTaskInlineEntry variant="hero" />);

    fireEvent.click(screen.getByTestId('select-agent'));
    fireEvent.click(screen.getByTestId('select-member'));
    fireEvent.keyDown(screen.getByTestId('task-editor'), { key: 'Enter', metaKey: true });

    await waitFor(() =>
      expect(createTaskMock).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeAgentId: 'agent-1', assigneeUserId: 'user-1' }),
      ),
    );
  });

  it('persists the responsible member when the scoped agent is locked', async () => {
    editorMarkdownMock.value = 'Coordinate the release';
    render(<CreateTaskInlineEntry lockAssignee agentId="agent-locked" variant="hero" />);

    fireEvent.click(screen.getByTestId('select-member'));

    await waitFor(() => {
      const draft = JSON.parse(
        localStorage.getItem('lobehub:task-create-draft:workspace-1:agent-locked') || '{}',
      );
      expect(draft).toMatchObject({ assigneeUserId: 'user-1' });
    });
  });

  it('resets member assignment and draft persistence when the workspace changes', async () => {
    editorMarkdownMock.value = 'Coordinate the release';
    const { rerender } = render(<CreateTaskInlineEntry variant="hero" />);

    fireEvent.click(screen.getByTestId('select-member'));
    await waitFor(() => {
      const draft = JSON.parse(
        localStorage.getItem('lobehub:task-create-draft:workspace-1:all') || '{}',
      );
      expect(draft).toMatchObject({ assigneeUserId: 'user-1' });
    });

    activeWorkspaceMock.id = 'workspace-2';
    // The real workspace hook publishes a store update. Change one prop here
    // as well so the memoized test component observes the mocked hook value.
    rerender(<CreateTaskInlineEntry placeholder="New workspace" variant="hero" />);

    await waitFor(() =>
      expect(screen.getByTestId('member-selector')).toHaveAttribute('data-current-user-id', ''),
    );
    await waitFor(() => {
      const draft = JSON.parse(
        localStorage.getItem('lobehub:task-create-draft:workspace-2:all') || '{}',
      );
      expect(draft.assigneeUserId).toBeUndefined();
    });
  });

  it('drops an incompatible restored member when the assigned agent is private', async () => {
    localStorage.setItem(
      'lobehub:task-create-draft:workspace-1:all',
      JSON.stringify({
        assigneeAgentId: 'agent-private',
        assigneeUserId: 'user-1',
        markdown: 'Coordinate a private task',
        visibility: 'public',
      }),
    );

    render(<CreateTaskInlineEntry variant="hero" />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-selector')).toHaveAttribute(
        'data-current-agent-id',
        'agent-private',
      );
      expect(screen.getByTestId('member-selector')).toHaveAttribute('data-current-user-id', '');
      expect(screen.getByTestId('visibility-trigger')).toHaveAttribute(
        'data-visibility',
        'private',
      );
    });
  });

  it('drops a restored member who is no longer assignable in the workspace', async () => {
    workspaceMembersMock.members = [{ role: 'viewer', userId: 'user-1' }];
    localStorage.setItem(
      'lobehub:task-create-draft:workspace-1:all',
      JSON.stringify({
        assigneeUserId: 'user-1',
        markdown: 'Coordinate a workspace task',
        visibility: 'public',
      }),
    );

    render(<CreateTaskInlineEntry variant="hero" />);

    await waitFor(() =>
      expect(screen.getByTestId('member-selector')).toHaveAttribute('data-current-user-id', ''),
    );
  });
  it('confirms the task exists once it is created, and offers a way to open it', async () => {
    editorMarkdownMock.value = 'Write a project plan';
    analyzeIntentMock.mockResolvedValue(clearReading);
    createTaskMock.mockResolvedValue({ identifier: 'TASK-9', name: 'Write the Q3 project plan' });

    render(<CreateTaskInlineEntry variant="hero" />);
    fireEvent.keyDown(screen.getByTestId('task-editor'), { key: 'Enter', metaKey: true });

    // Creating leaves the user on the list, so the spinner blinking out was the
    // only other signal — the flow ended with nothing saying the task existed.
    // (The visible name rides the i18n interpolation, which this suite's `t`
    // stub collapses to the key, so the assertion is on the action instead.)
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledTimes(1));

    toastSuccessMock.mock.calls[0][0].actions[0].onClick();
    expect(navigateMock).toHaveBeenCalledWith(expect.stringContaining('TASK-9'));
  });

  describe('intent recognition', () => {
    beforeEach(() => {
      setLabs({ enableTopicAcceptance: true });
      editorMarkdownMock.value = 'Write a project plan';
    });

    it('reads the draft on every submit — there is no setting to turn it on', async () => {
      analyzeIntentMock.mockResolvedValue(clearReading);

      render(<CreateTaskInlineEntry variant="hero" />);
      fireEvent.keyDown(screen.getByTestId('task-editor'), { key: 'Enter', metaKey: true });

      await waitFor(() => expect(analyzeIntentMock).toHaveBeenCalledTimes(1));
    });

    it('creates an unambiguous draft straight through, named by the reading', async () => {
      analyzeIntentMock.mockResolvedValue(clearReading);

      render(<CreateTaskInlineEntry variant="hero" />);
      fireEvent.keyDown(screen.getByTestId('task-editor'), { key: 'Enter', metaKey: true });

      await waitFor(() => expect(createTaskMock).toHaveBeenCalledTimes(1));
      expect(createTaskMock).toHaveBeenCalledWith(
        expect.objectContaining({
          instruction: 'Write a project plan',
          name: 'Write the Q3 project plan',
        }),
      );
      expect(screen.queryByText('taskIntent.reviewStep')).toBeNull();
    });

    it('holds a draft with an open question and folds the answer into the brief', async () => {
      analyzeIntentMock.mockResolvedValue({
        ...clearReading,
        clarifications: [{ options: ['lobe-chat'], question: 'Which repo?' }],
        confidence: 'medium',
      });

      render(<CreateTaskInlineEntry variant="hero" />);
      fireEvent.keyDown(screen.getByTestId('task-editor'), { key: 'Enter', metaKey: true });

      await screen.findByText('taskIntent.reviewStep');
      expect(createTaskMock).not.toHaveBeenCalled();

      // Answering the last question lands on the confirm step, and the primary
      // button says so — it reads "create task" on no step any more, which is
      // what left users unsure whether pressing it was the end of the flow.
      fireEvent.click(screen.getByText('lobe-chat'));
      fireEvent.click(await screen.findByText('taskIntent.confirmCreate'));

      await waitFor(() => expect(createTaskMock).toHaveBeenCalledTimes(1));
      expect(createTaskMock.mock.calls[0][0].instruction).toContain(
        '## taskIntent.answersHeading\n- Which repo? lobe-chat',
      );
      expect(createTaskMock.mock.calls[0][0].name).toBe('Write the Q3 project plan');
    });

    it('sends a rich-text mirror carrying the same answers as the instruction', async () => {
      // editorData wins over the markdown when a task is rendered, so a mirror
      // left on the pre-review draft would show the user a brief the agent
      // never received.
      editorJsonMock.value = {
        root: {
          children: [
            { children: [{ text: 'Write a project plan', type: 'text' }], type: 'paragraph' },
          ],
          type: 'root',
        },
      };
      analyzeIntentMock.mockResolvedValue({
        ...clearReading,
        clarifications: [{ options: ['lobe-chat'], question: 'Which repo?' }],
        confidence: 'medium',
      });

      render(<CreateTaskInlineEntry variant="hero" />);
      fireEvent.keyDown(screen.getByTestId('task-editor'), { key: 'Enter', metaKey: true });

      await screen.findByText('taskIntent.reviewStep');
      fireEvent.click(screen.getByText('lobe-chat'));
      fireEvent.click(await screen.findByText('taskIntent.confirmCreate'));

      await waitFor(() => expect(createTaskMock).toHaveBeenCalledTimes(1));
      const { editorData, instruction } = createTaskMock.mock.calls[0][0];
      const mirrored = (editorData as any).root.children
        .flatMap((node: any) => (node.children ?? []).map((child: any) => child.text))
        .join('\n');

      expect(mirrored).toContain('- Which repo? lobe-chat');
      expect(instruction).toContain('- Which repo? lobe-chat');
    });

    it('offers the goal handoff only for a request read as a standing goal', async () => {
      analyzeIntentMock.mockResolvedValue({ ...clearReading, kind: 'goal' });

      render(<CreateTaskInlineEntry variant="hero" />);
      fireEvent.keyDown(screen.getByTestId('task-editor'), { key: 'Enter', metaKey: true });

      fireEvent.click(await screen.findByText('taskIntent.goalCallout.action'));

      expect(createGoalModalMock).toHaveBeenCalledWith(
        expect.objectContaining({ initialTitle: 'Write the Q3 project plan' }),
      );
      expect(createTaskMock).not.toHaveBeenCalled();
    });

    it('still creates the task when the reading itself fails', async () => {
      analyzeIntentMock.mockRejectedValue(new Error('model unavailable'));

      render(<CreateTaskInlineEntry variant="hero" />);
      fireEvent.keyDown(screen.getByTestId('task-editor'), { key: 'Enter', metaKey: true });

      await waitFor(() => expect(createTaskMock).toHaveBeenCalledTimes(1));
      expect(screen.queryByText('taskIntent.reviewStep')).toBeNull();
    });
  });

  describe('persisted draft across a create', () => {
    const DRAFT_KEY = 'lobehub:task-create-draft:workspace-1:all';

    beforeEach(() => {
      localStorage.clear();
      editorMarkdownMock.value = 'Write a project plan';
      analyzeIntentMock.mockResolvedValue(clearReading);
    });

    it('takes the draft off disk before the create resolves, not after', async () => {
      // Creating the first task flips the list from empty to non-empty, which
      // remounts the composer *during* this await. The new instance hydrates
      // from this key, so a draft still on disk here reappears on screen and
      // the success reset lands on the old, unmounted instance.
      let release: (value: { identifier: string }) => void = () => {};
      createTaskMock.mockReturnValue(
        new Promise<{ identifier: string }>((resolve) => {
          release = resolve;
        }),
      );

      render(<CreateTaskInlineEntry variant="hero" />);
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ markdown: 'Write a project plan' }));

      fireEvent.keyDown(screen.getByTestId('task-editor'), { key: 'Enter', metaKey: true });

      await waitFor(() => expect(createTaskMock).toHaveBeenCalledTimes(1));
      expect(localStorage.getItem(DRAFT_KEY)).toBeNull();

      release({ identifier: 'task-1' });
      await waitFor(() => expect(localStorage.getItem(DRAFT_KEY)).toBeNull());
    });

    it('puts the draft back when the create fails', async () => {
      createTaskMock.mockRejectedValue(new Error('offline'));

      render(<CreateTaskInlineEntry variant="hero" />);
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ markdown: 'Write a project plan' }));

      fireEvent.keyDown(screen.getByTestId('task-editor'), { key: 'Enter', metaKey: true });

      await waitFor(() => expect(createTaskMock).toHaveBeenCalledTimes(1));
      // Nothing was created, so the work is still the user's: it stays on disk
      // to match the text the composer is still showing.
      await waitFor(() =>
        expect(localStorage.getItem(DRAFT_KEY)).toContain('Write a project plan'),
      );
    });
  });
});
