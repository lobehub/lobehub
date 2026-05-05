import type { BriefAction } from '@lobechat/types';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useBriefStore } from '@/store/brief';

import BriefCardActions from '../BriefCardActions';

const renderWithRouter = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

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
        'brief.editResult': 'Edit',
        'brief.viewRun': 'View run',
      };
      return map[key] || key;
    },
  }),
}));

const mockResolveBrief = vi.fn();

const sampleActions: BriefAction[] = [
  { key: 'approve', label: 'Approve', type: 'resolve' },
  { key: 'feedback', label: 'Feedback', type: 'comment' },
];

beforeEach(() => {
  vi.clearAllMocks();
  useBriefStore.setState({
    resolveBrief: mockResolveBrief,
  });
});

describe('BriefCardActions', () => {
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
    await Promise.resolve();
    expect(onAfterResolve).toHaveBeenCalled();
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
    const commentButton = container.querySelector('.brief-comment-btn');
    expect(commentButton).toBeInTheDocument();
    fireEvent.click(commentButton!);

    // CommentInput replaces action buttons
    expect(screen.queryByText('Approve')).not.toBeInTheDocument();
    expect(screen.getByTitle('Submit feedback')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
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
