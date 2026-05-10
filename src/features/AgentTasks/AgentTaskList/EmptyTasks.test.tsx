import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handleCreateTask: vi.fn(),
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
    Flexbox: Div,
    Icon: () => <span data-testid="empty-icon" />,
    Text: ({ children, ...props }: any) => <span {...props}>{children}</span>,
  };
});

vi.mock('antd', () => ({
  Divider: ({ children }: any) => <div data-testid="template-divider">{children}</div>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
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

vi.mock('../CreateTaskModal/useCreateTaskAndNavigate', () => ({
  useCreateTaskAndNavigate: () => mocks.handleCreateTask,
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

  it('hides recommendations and template divider when the hook is hidden', async () => {
    mocks.recommendationsState = { mode: 'hidden' };
    const user = userEvent.setup();
    render(<EmptyTasks />);

    expect(screen.queryByTestId('recommended-task-templates')).not.toBeInTheDocument();
    expect(screen.queryByTestId('template-divider')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'taskList.empty.createButton' }));

    expect(mocks.handleCreateTask).toHaveBeenCalledTimes(1);
  });

  it('shows the primary CTA, divider, and recommendations in skeleton mode', () => {
    mocks.recommendationsState = { mode: 'skeleton' };
    render(<EmptyTasks />);
    expect(screen.getByRole('button', { name: 'taskList.empty.createButton' })).toBeInTheDocument();
    expect(screen.getByTestId('template-divider')).toHaveTextContent(
      'taskList.empty.templateDivider',
    );
    expect(screen.getByTestId('recommended-task-templates')).toBeInTheDocument();
  });

  it('shows the primary CTA, divider, and recommendations in cards mode', () => {
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
    expect(screen.getByRole('button', { name: 'taskList.empty.createButton' })).toBeInTheDocument();
    expect(screen.getByTestId('template-divider')).toBeInTheDocument();
    expect(screen.getByTestId('recommended-task-templates')).toBeInTheDocument();
  });
});
