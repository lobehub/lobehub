import { render, screen } from '@testing-library/react';

import Notification from './Notification';

vi.mock('@lobechat/const', () => ({
  isDesktop: true,
}));

vi.mock('./SubscriptionIframeWrapper', () => ({
  SubscriptionIframeWrapper: ({ page }: { page: string }) => (
    <div data-page={page} data-testid="subscription-iframe-wrapper" />
  ),
}));

describe('Notification', () => {
  it('renders the notification embed page on desktop', () => {
    render(<Notification />);

    expect(screen.getByTestId('subscription-iframe-wrapper')).toHaveAttribute(
      'data-page',
      'notification',
    );
  });
});
