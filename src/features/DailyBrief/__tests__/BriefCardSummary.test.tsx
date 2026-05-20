import { fireEvent, render, screen } from '@testing-library/react';
import { useSize } from 'ahooks';
import { describe, expect, it, vi } from 'vitest';

import BriefCardSummary, { COLLAPSED_MAX_HEIGHT } from '../BriefCardSummary';

vi.mock('ahooks', () => ({
  useSize: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'brief.collapse': 'Show less',
        'brief.expandAll': 'Show more',
      };
      return map[key] || key;
    },
  }),
}));

describe('BriefCardSummary', () => {
  it('should render summary text', () => {
    vi.mocked(useSize).mockReturnValue(undefined);
    render(<BriefCardSummary summary="Test summary content" />);
    expect(screen.getByText('Test summary content')).toBeInTheDocument();
  });

  it('should not show expand link when content does not overflow', () => {
    vi.mocked(useSize).mockReturnValue({ height: COLLAPSED_MAX_HEIGHT - 10, width: 100 });
    render(<BriefCardSummary summary="Short" />);
    expect(screen.queryByText('Show more')).not.toBeInTheDocument();
  });

  it('should show expand link and toggle when content overflows', () => {
    vi.mocked(useSize).mockReturnValue({ height: COLLAPSED_MAX_HEIGHT + 50, width: 100 });

    render(<BriefCardSummary summary="A very long summary that overflows" />);

    const expandLink = screen.getByText('Show more');
    expect(expandLink).toBeInTheDocument();

    fireEvent.click(expandLink);
    expect(screen.getByText('Show less')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Show less'));
    expect(screen.getByText('Show more')).toBeInTheDocument();
  });
});
