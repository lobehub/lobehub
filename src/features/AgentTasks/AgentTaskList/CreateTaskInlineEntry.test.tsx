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

vi.mock('@lobehub/editor/react', () => ({
  useEditor: () => ({
    cleanDocument: vi.fn(),
    focus: focusMock,
    getLexicalEditor: () => undefined,
  }),
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

vi.mock('../shared/useAgentDisplayMeta', () => ({
  useAgentDisplayMeta: () => undefined,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('CreateTaskInlineEntry', () => {
  beforeEach(() => {
    permissionMock.allowed = true;
    focusMock.mockReset();
  });

  it('renders the task editor as disabled when the user cannot create content', () => {
    permissionMock.allowed = false;

    render(<CreateTaskInlineEntry variant="hero" />);

    expect(screen.getByTestId('task-editor')).toHaveAttribute('data-disabled', 'true');
    expect(focusMock).not.toHaveBeenCalled();
  });
});
