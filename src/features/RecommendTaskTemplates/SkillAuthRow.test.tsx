/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SkillAuthRow } from './SkillAuthRow';

const connectMock = vi.hoisted(() => vi.fn());

vi.mock('./useSkillConnection', () => ({
  SkillConnectionPopupBlockedError: class SkillConnectionPopupBlockedError extends Error {},
  useSkillConnection: () => ({
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

describe('SkillAuthRow', () => {
  beforeEach(() => {
    connectMock.mockReset();
  });

  it('disables provider connection when template actions are disabled', () => {
    render(
      <SkillAuthRow
        disabled
        spec={{ identifier: 'gmail', source: 'composio' }}
        onError={vi.fn()}
      />,
    );

    const connectButton = screen.getByRole('button', { name: 'action.connect.short' });
    expect(connectButton).toBeDisabled();

    fireEvent.click(connectButton);
    expect(connectMock).not.toHaveBeenCalled();
  });
});
