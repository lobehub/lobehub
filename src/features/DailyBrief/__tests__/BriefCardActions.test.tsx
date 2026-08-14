import type * as LobechatConst from '@lobechat/const';
import { RENDERER_HANDLED_LINK_ATTR } from '@lobechat/desktop-bridge';
import type { BriefAction } from '@lobechat/types';
import { toast } from '@lobehub/ui/base-ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useBriefStore } from '@/store/brief';
import { useTaskStore } from '@/store/task';

import BriefCardActions from '../BriefCardActions';

const renderWithRouter = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<typeof LobechatConst>()),
  isDesktop: true,
}));

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'brief.resolved': 'Marked as resolved',
        'cancel': 'Cancel',
        'brief.commentPlaceholder': 'Share your feedback...',
        'brief.commentSubmit': 'Submit feedback',
        'brief.action.confirm': 'Confirm',
        'brief.action.confirmDone': 'Confirm complete',
        'brief.action.review': 'Review delivery',
        'brief.editResult': 'Edit',
        'brief.viewRun': 'View run',
      };
      return map[key] || key;
    },
  }),
}));

// The real editor cannot be driven headlessly — `getDocument('markdown')` comes
// back empty in jsdom, so its send button is a no-op and the submit paths would
// be untestable. The stub keeps the affordances the other cases assert on.
vi.mock('../CommentInput', () => ({
  default: ({
    onCancel,
    onSubmit,
  }: {
    onCancel: () => void;
    onSubmit: (text: string) => void | Promise<void>;
  }) => (
    <div>
      <button type={'button'} onClick={onCancel}>
        Cancel
      </button>
      <button title={'Submit feedback'} type={'button'} onClick={() => onSubmit('my feedback')}>
        send
      </button>
    </div>
  ),
}));

const mockResolveBrief = vi.fn();
const mockSubmitFeedback = vi.fn();
const mockSetActiveTaskId = vi.fn();
const mockOpenTopicDrawer = vi.fn();
const mockToastError = vi.spyOn(toast, 'error').mockReturnValue(undefined as never);

const sampleActions: BriefAction[] = [
  { key: 'approve', label: 'Approve', type: 'resolve' },
  { key: 'feedback', label: 'Feedback', type: 'comment' },
];

beforeEach(() => {
  vi.clearAllMocks();
  useBriefStore.setState({
    resolveBrief: mockResolveBrief,
    submitFeedback: mockSubmitFeedback,
  });
  useTaskStore.setState({
    openTopicDrawer: mockOpenTopicDrawer,
    setActiveTaskId: mockSetActiveTaskId,
  });
});

describe('BriefCardActions', () => {
  it('should route primary and secondary link actions through BriefActionLink', () => {
    const actions: BriefAction[] = [
      { key: 'primary', label: 'Primary link', type: 'link', url: '/settings/profile' },
      { key: 'secondary', label: 'Secondary link', type: 'link', url: '/settings/common' },
    ];

    renderWithRouter(
      <BriefCardActions
        actions={actions}
        agentId="agent-1"
        briefId="brief-links"
        briefType="decision"
        taskId="task-1"
      />,
    );

    expect(screen.getByRole('button', { name: 'Primary link' })).toHaveAttribute(
      RENDERER_HANDLED_LINK_ATTR,
      'true',
    );
    expect(screen.getByRole('button', { name: 'Secondary link' })).toHaveAttribute(
      RENDERER_HANDLED_LINK_ATTR,
      'true',
    );
  });

  it('should leave a taskless acceptance link to the desktop preload interceptor', () => {
    renderWithRouter(
      <BriefCardActions
        briefId="brief-acceptance"
        briefType="decision"
        actions={[
          {
            key: 'review',
            label: 'Review acceptance',
            type: 'link',
            url: '/acceptance/acceptance-1',
          },
        ]}
      />,
    );

    const link = screen.getByRole('button', { name: 'Review delivery' });
    expect(link).not.toHaveAttribute(RENDERER_HANDLED_LINK_ATTR);
    expect(fireEvent.click(link)).toBe(true);
  });

  it('should render resolve action buttons from actions prop', () => {
    renderWithRouter(
      <BriefCardActions actions={sampleActions} briefId="brief-1" briefType="decision" />,
    );
    expect(screen.getByText('Approve')).toBeInTheDocument();
  });

  it('should render comment action button', () => {
    const { container } = renderWithRouter(
      <BriefCardActions
        actions={sampleActions}
        briefId="brief-1"
        briefType="decision"
        taskId="task-1"
      />,
    );
    const commentButton = container.querySelector('.brief-comment-btn');
    expect(commentButton).toBeInTheDocument();
  });

  it('should call resolveBrief and onAfterResolve on resolve button click', async () => {
    mockResolveBrief.mockResolvedValueOnce(undefined);
    const onAfterResolve = vi.fn();
    renderWithRouter(
      <BriefCardActions
        actions={sampleActions}
        briefId="brief-1"
        briefType="decision"
        onAfterResolve={onAfterResolve}
      />,
    );

    fireEvent.click(screen.getByText('Approve'));

    expect(mockResolveBrief).toHaveBeenCalledWith('brief-1', 'approve');
    // `waitFor`, not a single microtask tick: the refresh runs after the
    // mutation settles, so the number of awaits in between is an implementation
    // detail this assertion must not encode.
    await waitFor(() => expect(onAfterResolve).toHaveBeenCalled());
  });

  it('should open the run drawer with the brief agent riding the open call', () => {
    renderWithRouter(
      <BriefCardActions
        agentId="agent-1"
        briefId="brief-1"
        briefType="error"
        taskId="task-1"
        topicId="topic-1"
        topicTitle="Nightly cleanup"
      />,
    );

    fireEvent.click(screen.getByText('View run'));

    expect(mockSetActiveTaskId).toHaveBeenCalledWith('task-1');
    // The agent/title must ride openTopicDrawer itself: setActiveTaskId clears
    // the drawer's agent state, so without this the drawer's `open` gate stays
    // false until (unless) the task-detail fetch resolves.
    expect(mockOpenTopicDrawer).toHaveBeenCalledWith('topic-1', {
      agentId: 'agent-1',
      title: 'Nightly cleanup',
    });
    expect(mockSetActiveTaskId.mock.invocationCallOrder[0]).toBeLessThan(
      mockOpenTopicDrawer.mock.invocationCallOrder[0],
    );
  });

  it('should hide action buttons when comment button clicked', () => {
    const { container } = renderWithRouter(
      <BriefCardActions
        actions={sampleActions}
        briefId="brief-1"
        briefType="decision"
        taskId="task-1"
      />,
    );
    fireEvent.click(container.querySelector('.brief-comment-btn')!);
    expect(screen.queryByText('Approve')).not.toBeInTheDocument();
  });

  it('should show comment input when comment button clicked', () => {
    const { container } = renderWithRouter(
      <BriefCardActions
        actions={sampleActions}
        briefId="brief-1"
        briefType="decision"
        taskId="task-1"
      />,
    );
    fireEvent.click(container.querySelector('.brief-comment-btn')!);
    expect(screen.getByTitle('Submit feedback')).toBeInTheDocument();
  });

  it('should restore action buttons when comment cancelled', () => {
    const { container } = renderWithRouter(
      <BriefCardActions
        actions={sampleActions}
        briefId="brief-1"
        briefType="decision"
        taskId="task-1"
      />,
    );
    fireEvent.click(container.querySelector('.brief-comment-btn')!);
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.getByText('Approve')).toBeInTheDocument();
  });

  it('should submit feedback and refresh on send', async () => {
    mockSubmitFeedback.mockResolvedValueOnce(undefined);
    const onAfterAddComment = vi.fn();
    const { container } = renderWithRouter(
      <BriefCardActions
        actions={sampleActions}
        briefId="brief-1"
        briefType="decision"
        taskId="task-1"
        onAfterAddComment={onAfterAddComment}
      />,
    );
    fireEvent.click(container.querySelector('.brief-comment-btn')!);
    fireEvent.click(screen.getByTitle('Submit feedback'));
    await waitFor(() =>
      expect(mockSubmitFeedback).toHaveBeenCalledWith('brief-1', 'task-1', 'my feedback'),
    );
    await waitFor(() => expect(onAfterAddComment).toHaveBeenCalled());
  });

  it('should show resolved state when resolvedAction is set', () => {
    renderWithRouter(
      <BriefCardActions
        actions={sampleActions}
        briefId="brief-1"
        briefType="decision"
        resolvedAction="approve"
      />,
    );

    expect(screen.getByText('Marked as resolved')).toBeInTheDocument();
    expect(screen.queryByText('Approve')).not.toBeInTheDocument();
  });

  it('should fallback to DEFAULT_BRIEF_ACTIONS when actions prop is null', () => {
    renderWithRouter(<BriefCardActions actions={null} briefId="brief-2" briefType="decision" />);

    expect(screen.getByText('✅ Confirm')).toBeInTheDocument();
  });

  it('should localize a review link action instead of showing its persisted label', () => {
    renderWithRouter(
      <BriefCardActions
        briefId="brief-review"
        briefType="decision"
        actions={[
          {
            key: 'review',
            label: 'Legacy review label',
            type: 'link',
            url: '/acceptance/acceptance-1',
          },
        ]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Review delivery' })).toHaveAttribute(
      'href',
      '/acceptance/acceptance-1',
    );
    expect(screen.queryByText('Legacy review label')).not.toBeInTheDocument();
  });

  it('should hardcode primary action label to "Confirm complete" for result briefs', () => {
    renderWithRouter(
      <BriefCardActions
        actions={[{ key: 'approve', label: '✅ Custom approve', type: 'resolve' }]}
        briefId="brief-3"
        briefType="result"
      />,
    );

    expect(screen.getByText('Confirm complete')).toBeInTheDocument();
    expect(screen.queryByText('✅ Custom approve')).not.toBeInTheDocument();
  });

  it('should always show the Edit button for result briefs when taskId is set', () => {
    const { container } = renderWithRouter(
      <BriefCardActions
        actions={[{ key: 'approve', label: '✅ Custom', type: 'resolve' }]}
        briefId="brief-4"
        briefType="result"
        taskId="task-1"
      />,
    );

    expect(container.querySelector('.brief-comment-btn')).toBeInTheDocument();
  });

  it('should render the View run button when taskId and topicId are both set', () => {
    renderWithRouter(
      <BriefCardActions
        actions={sampleActions}
        briefId="brief-5"
        briefType="decision"
        taskId="task-5"
        topicId="topic-5"
      />,
    );
    expect(screen.getByText('View run')).toBeInTheDocument();
  });

  it('should not render the View run button when topicId is missing', () => {
    renderWithRouter(
      <BriefCardActions
        actions={sampleActions}
        briefId="brief-6"
        briefType="decision"
        taskId="task-6"
      />,
    );
    expect(screen.queryByText('View run')).not.toBeInTheDocument();
  });

  it('should label the result action "Confirm complete" when the parent task is not parked at scheduled', () => {
    renderWithRouter(
      <BriefCardActions
        actions={[{ key: 'approve', label: 'X', type: 'resolve' }]}
        briefId="brief-7"
        briefType="result"
        taskId="task-7"
        taskStatus={'paused'}
      />,
    );
    expect(screen.getByText('Confirm complete')).toBeInTheDocument();
    expect(screen.queryByText('Confirm', { exact: true })).not.toBeInTheDocument();
  });

  // Brief permission errors: the tRPC client only console.errors non-401 failures, so a
  // rejected action used to read as a dead button — which is how "no permission"
  // reached us as a bug report with no error on screen.
  it('should surface the failure reason when a resolve action is rejected', async () => {
    mockResolveBrief.mockRejectedValueOnce(
      new Error('You do not have permission to perform this action.'),
    );
    const onAfterResolve = vi.fn();
    renderWithRouter(
      <BriefCardActions
        actions={sampleActions}
        briefId="brief-9"
        briefType="decision"
        onAfterResolve={onAfterResolve}
      />,
    );

    fireEvent.click(screen.getByText('Approve'));

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        'You do not have permission to perform this action.',
      ),
    );
    expect(onAfterResolve).not.toHaveBeenCalled();
    // Still actionable — a failed attempt must not leave the card in limbo.
    expect(screen.getByText('Approve')).toBeInTheDocument();
  });

  it('should fall back to a generic message when the failure carries no reason', async () => {
    // A network abort / non-Error rejection reaches the handler without a message.
    mockResolveBrief.mockRejectedValueOnce({});
    renderWithRouter(
      <BriefCardActions actions={sampleActions} briefId="brief-10" briefType="decision" />,
    );

    fireEvent.click(screen.getByText('Approve'));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('brief.actionFailed'));
  });

  // The parent's refresh callbacks run *after* the mutation landed. Reporting
  // their rejection as an action failure would tell the user to retry a resolve
  // that already succeeded — and, on the feedback path, to re-send the comment
  // and re-run the task a second time.
  it('should not report a failure when only the post-resolve refresh rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockResolveBrief.mockResolvedValueOnce(undefined);
    const onAfterResolve = vi.fn().mockRejectedValue(new Error('refresh failed'));
    renderWithRouter(
      <BriefCardActions
        actions={sampleActions}
        briefId="brief-11"
        briefType="decision"
        onAfterResolve={onAfterResolve}
      />,
    );

    fireEvent.click(screen.getByText('Approve'));

    await waitFor(() => expect(onAfterResolve).toHaveBeenCalled());
    expect(mockToastError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('should close the feedback editor when the mutation lands but the refresh rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSubmitFeedback.mockResolvedValueOnce(undefined);
    const onAfterAddComment = vi.fn().mockRejectedValue(new Error('refresh failed'));
    const { container } = renderWithRouter(
      <BriefCardActions
        actions={sampleActions}
        briefId="brief-12"
        briefType="decision"
        taskId="task-1"
        onAfterAddComment={onAfterAddComment}
      />,
    );

    fireEvent.click(container.querySelector('.brief-comment-btn')!);
    fireEvent.click(screen.getByTitle('Submit feedback'));

    // Editor closed — leaving it open would invite a second send of feedback
    // that already resolved the brief and re-ran the task.
    await waitFor(() => expect(screen.getByText('Approve')).toBeInTheDocument());
    expect(mockSubmitFeedback).toHaveBeenCalledWith('brief-12', 'task-1', 'my feedback');
    expect(mockToastError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('should keep the feedback editor open when the mutation itself fails', async () => {
    mockSubmitFeedback.mockRejectedValueOnce(new Error('You do not have permission.'));
    const { container } = renderWithRouter(
      <BriefCardActions
        actions={sampleActions}
        briefId="brief-13"
        briefType="decision"
        taskId="task-1"
      />,
    );

    fireEvent.click(container.querySelector('.brief-comment-btn')!);
    fireEvent.click(screen.getByTitle('Submit feedback'));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('You do not have permission.'));
    // Still open — closing would discard the text the user typed.
    expect(screen.getByTitle('Submit feedback')).toBeInTheDocument();
  });

  it('should label the result action "Confirm" when the parent task is parked at status="scheduled"', () => {
    renderWithRouter(
      <BriefCardActions
        actions={[{ key: 'approve', label: 'X', type: 'resolve' }]}
        briefId="brief-8"
        briefType="result"
        taskId="task-8"
        taskStatus={'scheduled'}
      />,
    );
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    expect(screen.queryByText('Confirm complete')).not.toBeInTheDocument();
  });
});
