import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';

import TopicPanel from './TopicPanel';
import { useVisitorTopics } from './useVisitorTopics';

vi.mock('./useVisitorTopics', () => ({
  useVisitorTopics: vi.fn(),
}));

const mockUseVisitorTopics = vi.mocked(useVisitorTopics);

describe('TopicPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({ activeTopicId: undefined });
  });

  it('renders topic rows as keyboard-operable buttons that select the topic', () => {
    mockUseVisitorTopics.mockReturnValue({
      data: [{ id: 'tpc_1', title: 'Trip planning' }],
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    } as any);

    render(<TopicPanel shareId={'shr_1'} />);

    // A real <button> gives keyboard users a tab stop plus Enter/Space
    // activation for free — a clickable div gives them nothing.
    const row = screen.getByRole('button', { name: 'Trip planning' });
    fireEvent.click(row);

    expect(useChatStore.getState().activeTopicId).toBe('tpc_1');
  });

  it('marks the active topic row for assistive tech', () => {
    useChatStore.setState({ activeTopicId: 'tpc_1' });
    mockUseVisitorTopics.mockReturnValue({
      data: [
        { id: 'tpc_1', title: 'Trip planning' },
        { id: 'tpc_2', title: 'Groceries' },
      ],
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    } as any);

    render(<TopicPanel shareId={'shr_1'} />);

    expect(screen.getByRole('button', { name: 'Trip planning' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Groceries' })).not.toHaveAttribute('aria-current');
  });
});
