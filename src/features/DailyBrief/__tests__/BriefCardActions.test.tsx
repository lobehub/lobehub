import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useBriefStore } from '@/store/brief';

import BriefCardActions from '../BriefCardActions';

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'brief.resolved': 'Resolved',
        'cancel': 'Cancel',
        'brief.commentPlaceholder': 'Enter feedback...',
        'brief.commentSubmit': 'Submit',
      };
      return map[key] || key;
    },
  }),
}));

const mockResolveBrief = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  useBriefStore.setState({
    briefs: [
      {
        actions: [
          { key: 'approve', label: 'Approve', type: 'resolve' },
          { key: 'feedback', label: 'Feedback', type: 'comment' },
        ],
        id: 'brief-1',
        type: 'decision',
      } as any,
    ],
    resolveBrief: mockResolveBrief,
  });
});

describe('BriefCardActions', () => {
  it('should render resolve action buttons', () => {
    render(<BriefCardActions briefId="brief-1" briefType="decision" />);
    expect(screen.getByText('Approve')).toBeInTheDocument();
  });

  it('should render comment action button', () => {
    render(<BriefCardActions briefId="brief-1" briefType="decision" />);
    expect(screen.getByText('Feedback')).toBeInTheDocument();
  });

  it('should call resolveBrief on resolve button click', async () => {
    mockResolveBrief.mockResolvedValueOnce(undefined);
    render(<BriefCardActions briefId="brief-1" briefType="decision" />);

    fireEvent.click(screen.getByText('Approve'));

    expect(mockResolveBrief).toHaveBeenCalledWith('brief-1', 'approve');
  });

  it('should hide action buttons when comment button clicked', () => {
    render(<BriefCardActions briefId="brief-1" briefType="decision" />);

    fireEvent.click(screen.getByText('Feedback'));

    // CommentInput replaces action buttons
    expect(screen.queryByText('Approve')).not.toBeInTheDocument();
    expect(screen.getByText('Submit')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('should show resolved state when resolvedAction is set', () => {
    render(<BriefCardActions briefId="brief-1" briefType="decision" resolvedAction="approve" />);

    expect(screen.getByText('Resolved')).toBeInTheDocument();
    expect(screen.queryByText('Approve')).not.toBeInTheDocument();
  });

  it('should fallback to DEFAULT_BRIEF_ACTIONS when no actions in brief', () => {
    useBriefStore.setState({
      briefs: [{ actions: null, id: 'brief-2', type: 'result' } as any],
    });

    render(<BriefCardActions briefId="brief-2" briefType="result" />);

    expect(screen.getByText('✅ 通过')).toBeInTheDocument();
  });
});
