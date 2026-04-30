import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFollowUpActionStore } from '@/store/followUpAction';

import FollowUpChips from './FollowUpChips';

const MSG = 'msg-1';
const OTHER = 'msg-2';

// Mock useConversationStore so the component can render without a provider.
const sendMessageMock = vi.fn();
vi.mock('@/features/Conversation', () => ({
  useConversationStore: (selector: any) => selector({ sendMessage: sendMessageMock }),
}));

describe('<FollowUpChips />', () => {
  beforeEach(() => {
    sendMessageMock.mockReset();
    useFollowUpActionStore.getState().reset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when status is not ready', () => {
    useFollowUpActionStore.setState({
      chips: [{ label: 'x', message: 'x' }],
      messageId: MSG,
      status: 'loading',
    });
    const { container } = render(<FollowUpChips messageId={MSG} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when messageId mismatches', () => {
    useFollowUpActionStore.setState({
      chips: [{ label: 'x', message: 'x' }],
      messageId: OTHER,
      status: 'ready',
    });
    const { container } = render(<FollowUpChips messageId={MSG} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one button per chip', () => {
    useFollowUpActionStore.setState({
      chips: [
        { label: 'a', message: 'a' },
        { label: 'b', message: 'b' },
        { label: 'c', message: 'c' },
      ],
      messageId: MSG,
      status: 'ready',
    });
    render(<FollowUpChips messageId={MSG} />);
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('calls sendMessage and consume on click', () => {
    useFollowUpActionStore.setState({
      chips: [{ label: 'go', message: 'go ahead' }],
      messageId: MSG,
      status: 'ready',
    });
    render(<FollowUpChips messageId={MSG} />);
    fireEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(sendMessageMock).toHaveBeenCalledWith({ message: 'go ahead' });
    // consume() resets state to idle:
    expect(useFollowUpActionStore.getState().status).toBe('idle');
  });
});
