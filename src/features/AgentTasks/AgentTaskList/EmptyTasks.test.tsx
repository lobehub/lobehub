import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTaskModal: vi.fn(),
  navigate: vi.fn(),
  recommendationsState: { mode: 'hidden' } as { mode: string; [k: string]: unknown },
}));

vi.mock('@lobehub/ui', () => {
  const Div = ({ children, ...props }: any) => <div {...props}>{children}</div>;

  return {
    Button: ({ children, onClick }: any) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
    Center: Div,
    Flexbox: Div,
    Icon: () => <span data-testid="empty-icon" />,
    Text: ({ children, ...props }: any) => <span {...props}>{children}</span>,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('@/business/client/useTaskTemplateRecommendations', () => ({
  useTaskTemplateRecommendations: (options: { spmRoot?: string }) => {
    mocks.recommendationsState = {
      ...mocks.recommendationsState,
      __spmRoot: options?.spmRoot,
    } as typeof mocks.recommendationsState;
    return mocks.recommendationsState;
  },
}));

vi.mock('@/business/client/RecommendedTaskTemplates', () => ({
  RecommendedTaskTemplates: ({ state }: { state: { mode: string } }) => (
    <div data-mode={state.mode} data-testid="recommended-task-templates" />
  ),
}));

vi.mock('../CreateTaskModal', () => ({
  createTaskModal: mocks.createTaskModal,
}));

const { default: EmptyTasks } = await import('./EmptyTasks');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  mocks.recommendationsState = { mode: 'hidden' };
});

describe('EmptyTasks', () => {
  it('passes the empty-state spm root to the recommendations hook', () => {
    render(<EmptyTasks />);
    expect(mocks.recommendationsState).toMatchObject({
      __spmRoot: 'tasks.empty.task_templates',
    });
  });

  it('renders the hero copy in every mode', () => {
    render(<EmptyTasks />);
    expect(screen.getByText('taskList.empty.title')).toBeInTheDocument();
    expect(screen.getByText('taskList.empty.subtitle')).toBeInTheDocument();
  });

  it('shows the fallback Create task button when recommendations are hidden', async () => {
    mocks.recommendationsState = { mode: 'hidden' };
    const user = userEvent.setup();
    render(<EmptyTasks />);

    expect(screen.queryByTestId('recommended-task-templates')).not.toBeInTheDocument();

    const button = screen.getByRole('button', { name: 'taskList.empty.createButton' });
    await user.click(button);

    expect(mocks.createTaskModal).toHaveBeenCalledTimes(1);
    expect(mocks.createTaskModal.mock.calls[0][0]).toEqual(
      expect.objectContaining({ onCreated: expect.any(Function) }),
    );
  });

  it('navigates to the created task when the fallback CTA succeeds', async () => {
    mocks.recommendationsState = { mode: 'hidden' };
    const user = userEvent.setup();
    render(<EmptyTasks />);

    await user.click(screen.getByRole('button', { name: 'taskList.empty.createButton' }));

    const onCreated = mocks.createTaskModal.mock.calls[0][0].onCreated;
    onCreated({ identifier: 'T-42' });
    expect(mocks.navigate).toHaveBeenCalledWith('/task/T-42');
  });

  it('renders RecommendedTaskTemplates and hides the fallback CTA in skeleton mode', () => {
    mocks.recommendationsState = { mode: 'skeleton' };
    render(<EmptyTasks />);
    expect(screen.getByTestId('recommended-task-templates')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'taskList.empty.createButton' }),
    ).not.toBeInTheDocument();
  });

  it('renders RecommendedTaskTemplates and hides the fallback CTA in cards mode', () => {
    mocks.recommendationsState = {
      mode: 'cards',
      onCreated: vi.fn(),
      onDismiss: vi.fn(),
      recommendationBatchId: 'batch-1',
      spmRoot: 'tasks.empty.task_templates',
      templates: [],
      userInterestCount: 0,
    };
    render(<EmptyTasks />);
    expect(screen.getByTestId('recommended-task-templates')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'taskList.empty.createButton' }),
    ).not.toBeInTheDocument();
  });
});
