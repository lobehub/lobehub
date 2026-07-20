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

vi.mock('@lobehub/editor/react', () => ({
  useEditor: () => ({
    cleanDocument: vi.fn(),
    focus: focusMock,
    getDocument: (format: string) => (format === 'markdown' ? editorMarkdownMock.value : {}),
    getLexicalEditor: () => undefined,
  }),
}));

// Stub the base-ui Button (submit) to a native button — it needs a
// MotionProvider the app sets up globally but the unit env doesn't.
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} type="button" onClick={onClick}>
      {children}
    </button>
  ),
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

vi.mock('../features/TaskPriorityTag', () => ({
  default: ({ children }: { children?: ReactNode }) => (
    <div data-testid="priority">{children ?? 'priority'}</div>
  ),
}));

vi.mock('../features/AssigneeAgentSelector', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('../features/AssigneeAvatar', () => ({
  default: () => <div />,
}));

vi.mock('../features/TaskVisibilityTag', () => ({
  default: ({ children, lockedReason }: { children?: ReactNode; lockedReason?: string }) => (
    <button data-locked={String(Boolean(lockedReason))} data-testid="visibility-trigger">
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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('CreateTaskInlineEntry', () => {
  beforeEach(() => {
    permissionMock.allowed = true;
    activeWorkspaceMock.id = 'workspace-1';
    focusMock.mockReset();
    createTaskMock.mockReset();
    createTaskMock.mockResolvedValue({ identifier: 'task-1' });
    editorMarkdownMock.value = '';
    insertNewlineMock.mockReset();
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

    const attachmentAction = container.querySelector<HTMLElement>('[role="button"]');
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
});
