import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import BriefCardSummary from '../BriefCardSummary';
import { COLLAPSED_MAX_HEIGHT } from '../const';

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
    render(<BriefCardSummary summary="Test summary content" />);
    expect(screen.getByText('Test summary content')).toBeInTheDocument();
  });

  it('should not show expand link when content does not overflow', () => {
    render(<BriefCardSummary summary="Short" />);
    expect(screen.queryByText('Show more')).not.toBeInTheDocument();
  });

  it('should show expand link and toggle when content overflows', () => {
    // Mock scrollHeight to simulate overflow
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollHeight',
    );
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      value: COLLAPSED_MAX_HEIGHT + 50,
    });

    render(<BriefCardSummary summary="A very long summary that overflows" />);

    const expandLink = screen.getByText('Show more');
    expect(expandLink).toBeInTheDocument();

    fireEvent.click(expandLink);
    expect(screen.getByText('Show less')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Show less'));
    expect(screen.getByText('Show more')).toBeInTheDocument();

    // Restore
    if (originalDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalDescriptor);
    }
  });
});
