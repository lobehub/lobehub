/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProjectSelector from './ProjectSelector';
import TaskProjectValue from './TaskProjectValue';

const state = vi.hoisted(() => ({
  allowed: true,
  enabled: true,
  projects: undefined as { avatar?: string; id: string; name: string }[] | undefined,
  revalidate: vi.fn(),
  sync: { error: undefined as unknown, isHydrated: true, isValidating: false },
  updateTask: vi.fn(),
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Popover: ({
    children,
    content,
    disabled,
    onOpenChange,
    open,
  }: {
    children: ReactNode;
    content: ReactNode;
    disabled?: boolean;
    onOpenChange: (open: boolean) => void;
    open: boolean;
  }) => (
    <>
      <div
        data-testid="popover-trigger"
        onClickCapture={() => {
          if (!disabled) onOpenChange(!open);
        }}
      >
        {children}
      </div>
      {open && (
        <div
          data-testid="popover-content"
          onKeyDown={(event) => {
            if (event.key === 'Escape') onOpenChange(false);
          }}
        >
          {content}
        </div>
      )}
    </>
  ),
  Tooltip: ({ children, title }: { children: ReactNode; title?: string }) => (
    <div title={title}>{children}</div>
  ),
}));

vi.mock('@/features/NavPanel/components/NavItem', () => ({
  default: ({
    active,
    extra,
    onClick,
    title,
  }: {
    active?: boolean;
    extra?: ReactNode;
    onClick: () => void;
    title: string;
  }) => (
    <button data-active={active || undefined} onClick={onClick}>
      {title}
      {extra && <span data-testid="selected-mark" />}
    </button>
  ),
}));

vi.mock('@/features/NavPanel/components/SkeletonList', () => ({
  default: () => <div data-testid="skeleton" />,
}));

vi.mock('@/features/Projects/ProjectAvatar', () => ({
  default: ({ name }: { name: string }) => <span data-testid={`avatar-${name}`} />,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: state.allowed, reason: 'No permission' }),
}));

vi.mock('@/store/project', () => ({
  useCurrentProjectList: () => state.projects ?? [],
  useLoadedProjectList: () => state.projects,
  useProjectStore: (selector: (s: unknown) => unknown) =>
    selector({ useFetchProjectList: () => ({ ...state.sync, revalidate: state.revalidate }) }),
}));

vi.mock('@/store/task', () => ({
  useTaskStore: (selector: (s: unknown) => unknown) => selector({ updateTask: state.updateTask }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: { enableProjects: () => state.enabled },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

/** A host holding the pick, showing it the way the composer chip does. */
const Host = ({ initial = null }: { initial?: string | null }) => {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <ProjectSelector value={value} onChange={setValue}>
      <button data-testid="trigger">
        <TaskProjectValue emptyLabel="empty" iconSize={14} projectId={value} />
      </button>
    </ProjectSelector>
  );
};

const open = () => fireEvent.click(screen.getByTestId('trigger'));
const search = () => screen.getByPlaceholderText('taskProject.searchPlaceholder');
const trigger = () => screen.getByTestId('trigger');
const activeOption = () => document.querySelector('[data-active]')?.textContent;

beforeEach(() => {
  state.allowed = true;
  state.enabled = true;
  state.projects = [
    { id: 'p1', name: 'Apollo' },
    { id: 'p2', name: 'Website Redesign' },
  ];
  state.revalidate.mockClear();
  state.sync = { error: undefined, isHydrated: true, isValidating: false };
  state.updateTask.mockReset();
  state.updateTask.mockResolvedValue(undefined);
});

describe('ProjectSelector', () => {
  it('filters by name and says when nothing matches', () => {
    render(<Host />);
    open();
    expect(screen.getByText('Apollo')).toBeInTheDocument();

    fireEvent.change(search(), { target: { value: 'redes' } });
    expect(screen.queryByText('Apollo')).not.toBeInTheDocument();
    expect(screen.getByText('Website Redesign')).toBeInTheDocument();

    fireEvent.change(search(), { target: { value: 'zzz' } });
    expect(screen.getByText('taskProject.noMatch')).toBeInTheDocument();
  });

  it('echoes a pick on the trigger, marks it, and closes', () => {
    render(<Host />);
    expect(trigger()).toHaveTextContent('empty');

    open();
    fireEvent.click(screen.getByText('Apollo'));
    expect(trigger()).toHaveTextContent('Apollo');
    expect(screen.queryByTestId('popover-content')).not.toBeInTheDocument();

    open();
    expect(
      within(screen.getByTestId('popover-content')).getByTestId('selected-mark').parentElement,
    ).toHaveTextContent('Apollo');
  });

  it('clears through the "no project" row', () => {
    render(<Host initial="p1" />);
    expect(trigger()).toHaveTextContent('Apollo');

    open();
    fireEvent.click(screen.getByText('taskProject.none'));
    expect(trigger()).toHaveTextContent('empty');
  });

  it('navigates with the arrow keys, wraps, picks with Enter and closes with Esc', () => {
    render(<Host />);
    open();
    expect(activeOption()).toContain('taskProject.none');

    fireEvent.keyDown(search(), { key: 'ArrowDown' });
    expect(activeOption()).toContain('Apollo');
    fireEvent.keyDown(search(), { key: 'ArrowUp' });
    fireEvent.keyDown(search(), { key: 'ArrowUp' });
    expect(activeOption()).toContain('Website Redesign');

    fireEvent.keyDown(search(), { key: 'Escape' });
    expect(screen.queryByTestId('popover-content')).not.toBeInTheDocument();
    expect(trigger()).toHaveTextContent('empty');

    open();
    fireEvent.change(search(), { target: { value: 'apol' } });
    fireEvent.keyDown(search(), { key: 'Enter' });
    expect(trigger()).toHaveTextContent('Apollo');
  });

  it('opens on the current project', () => {
    render(<Host initial="p2" />);
    open();
    expect(activeOption()).toContain('Website Redesign');
  });

  it('leaves Enter alone during IME composition and for the composer submit', () => {
    render(<Host />);
    open();
    fireEvent.change(search(), { target: { value: 'apol' } });
    fireEvent.keyDown(search(), { isComposing: true, key: 'Enter' });
    fireEvent.keyDown(search(), { key: 'Enter', metaKey: true });
    expect(trigger()).toHaveTextContent('empty');
    expect(screen.getByTestId('popover-content')).toBeInTheDocument();
  });

  it('opens from the keyboard', () => {
    render(<Host />);
    fireEvent.keyDown(screen.getByRole('button', { expanded: false }), { key: 'Enter' });
    expect(screen.getByTestId('popover-content')).toBeInTheDocument();
  });

  it('saves to the task when there is no draft to hold the pick', async () => {
    render(
      <ProjectSelector taskIdentifier="T-1" value="p1">
        <button data-testid="trigger">row</button>
      </ProjectSelector>,
    );
    open();
    fireEvent.click(screen.getByText('Website Redesign'));
    expect(state.updateTask).toHaveBeenCalledWith('T-1', { projectId: 'p2' });

    open();
    fireEvent.click(screen.getByText('taskProject.none'));
    expect(state.updateTask).toHaveBeenLastCalledWith('T-1', { projectId: null });
  });

  it('does not write when the current project is picked again', () => {
    render(
      <ProjectSelector taskIdentifier="T-1" value="p1">
        <button data-testid="trigger">row</button>
      </ProjectSelector>,
    );
    open();
    fireEvent.click(screen.getByText('Apollo'));
    expect(state.updateTask).not.toHaveBeenCalled();
  });

  it('swallows a failed save, which the store has already toasted and rolled back', async () => {
    state.updateTask.mockRejectedValue(new Error('refused'));
    render(
      <ProjectSelector taskIdentifier="T-1" value="p1">
        <button data-testid="trigger">row</button>
      </ProjectSelector>,
    );
    open();
    fireEvent.click(screen.getByText('taskProject.none'));
    await waitFor(() => expect(state.updateTask).toHaveBeenCalled());
  });

  it('renders nothing while Projects is off', () => {
    state.enabled = false;
    render(<Host initial="p1" />);
    expect(screen.queryByTestId('trigger')).not.toBeInTheDocument();
  });

  it('is read-only without write permission', () => {
    state.allowed = false;
    render(<Host initial="p1" />);
    expect(screen.getByTitle('No permission')).toBeInTheDocument();
    open();
    expect(screen.queryByTestId('popover-content')).not.toBeInTheDocument();
  });

  it('is read-only with a host-given reason', () => {
    render(
      <ProjectSelector disabledReason="inherited" taskIdentifier="T-1" value="p1">
        <button data-testid="trigger">row</button>
      </ProjectSelector>,
    );
    expect(screen.getByTitle('inherited')).toBeInTheDocument();
    open();
    expect(screen.queryByTestId('popover-content')).not.toBeInTheDocument();
  });

  it('shows a skeleton while the list first loads', () => {
    state.projects = undefined;
    state.sync = { error: undefined, isHydrated: false, isValidating: true };
    render(<Host />);
    open();
    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
  });

  it('offers a retry when the list fails to load', () => {
    state.projects = undefined;
    state.sync = { error: new Error('offline'), isHydrated: true, isValidating: false };
    render(<Host />);
    open();
    fireEvent.click(screen.getByText('retry'));
    expect(state.revalidate).toHaveBeenCalled();
  });

  it('keeps the clear row and says so when the workspace has no projects', () => {
    state.projects = [];
    render(<Host />);
    open();
    expect(screen.getByText('taskProject.none')).toBeInTheDocument();
    expect(screen.getByText('taskProject.empty')).toBeInTheDocument();
  });

  it('shows no other name for a project outside the list, and can still clear it', () => {
    render(<Host initial="gone" />);
    expect(trigger()).toHaveTextContent('taskProject.unavailable');
    expect(trigger()).not.toHaveTextContent('Apollo');

    open();
    expect(screen.queryByTestId('selected-mark')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('taskProject.none'));
    expect(trigger()).toHaveTextContent('empty');
  });

  it('does not guess a name before the list has loaded', () => {
    state.projects = undefined;
    render(<Host initial="p1" />);
    expect(trigger()).toHaveTextContent('taskProject.label');
  });
});
