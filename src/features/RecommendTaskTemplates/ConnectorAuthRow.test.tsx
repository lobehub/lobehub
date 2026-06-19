/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorAuthRow } from './ConnectorAuthRow';

const connectMock = vi.hoisted(() => vi.fn());

vi.mock('./useConnectorConnection', () => ({
  ConnectorConnectionMarketAuthRequiredError: class ConnectorConnectionMarketAuthRequiredError extends Error {},
  ConnectorConnectionPopupBlockedError: class ConnectorConnectionPopupBlockedError extends Error {},
  useConnectorConnection: () => ({
    connect: connectMock,
    isAllConnected: false,
    isConnecting: false,
  }),
}));

vi.mock('./providerMeta', () => ({
  getProviderMeta: () => ({ icon: 'https://example.com/icon.png', label: 'HubSpot' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('ConnectorAuthRow', () => {
  beforeEach(() => {
    connectMock.mockReset();
  });

  it('disables provider connection when template actions are disabled', () => {
    render(
      <ConnectorAuthRow
        disabled
        spec={{ identifier: 'gmail', source: 'composio' }}
        onError={vi.fn()}
      />,
    );

    const connectButton = screen.getByRole('button', {
      name: 'taskTemplate.action.connect.short',
    });
    expect(connectButton).toBeDisabled();

    fireEvent.click(connectButton);
    expect(connectMock).not.toHaveBeenCalled();
  });
});
