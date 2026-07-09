/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CreateTaskInlineEntry from './CreateTaskInlineEntry';

const permissionMock = vi.hoisted(() => ({
  allowed: true,
}));

const focusMock = vi.hoisted(() => vi.fn());
const activeWorkspaceMock = vi.hoisted(() => ({
  id: 'workspace-1' as string | undefined,
}));

vi.mock('@lobehub/editor/react', () => ({
  useEditor: () => ({
    cleanDocument: vi.fn(),
    focus: focusMock,
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
  EditorCanvas: ({ disabled }: { disabled?: boolean }) => (
    <div data-disabled={String(!!disabled)} data-testid="task-editor" />
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
      createTask: vi.fn(),
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
});
