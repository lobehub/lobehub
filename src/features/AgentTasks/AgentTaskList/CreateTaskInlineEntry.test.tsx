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
    getDocument: (format: string) => (format === 'markdown' ? editorMarkdownMock.value : {}),
    getLexicalEditor: () => undefined,
  }),
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { error: vi.fn(), success: vi.fn() },
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

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ user: { id: 'self-user' } }),
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

describe('CreateTaskInlineEntry', () => {
  beforeEach(() => {
    permissionMock.allowed = true;
    activeWorkspaceMock.id = 'workspace-1';
    workspaceMembersMock.isLoading = false;
    workspaceMembersMock.members = [{ role: 'member', userId: 'user-1' }];
    focusMock.mockReset();
    createTaskMock.mockReset();
    createTaskMock.mockResolvedValue({ identifier: 'task-1' });
    editorMarkdownMock.value = '';
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
});
