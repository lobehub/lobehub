import type { BriefAction } from '@lobechat/types';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useBriefStore } from '@/store/brief';

import BriefCardActions from '../BriefCardActions';

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'brief.resolved': 'Marked as resolved',
        'cancel': 'Cancel',
        'brief.commentPlaceholder': 'Share your feedback...',
        'brief.commentSubmit': 'Submit feedback',
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
    render(<BriefCardActions actions={sampleActions} briefId="brief-1" briefType="decision" />);
    expect(screen.getByText('Approve')).toBeInTheDocument();
  });

  it('should render comment action button', () => {
    const { container } = render(
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
    render(
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
    const { container } = render(
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
    render(
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
    render(<BriefCardActions actions={null} briefId="brief-2" briefType="result" />);

    expect(screen.getByText('✅ 通过')).toBeInTheDocument();
  });
});
