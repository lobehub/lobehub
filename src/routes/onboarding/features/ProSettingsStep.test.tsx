import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MouseEventHandler, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ProSettingsStep from './ProSettingsStep';

vi.mock('@lobehub/ui', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: MouseEventHandler<HTMLButtonElement>;
  }) => (
    <button disabled={disabled} type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'back': 'Back',
          'next': 'Next',
          'proSettings.connectors.title': 'Connect Your Favorite Tools',
        }) as Record<string, string>
      )[key] ?? key,
  }),
}));

vi.mock('@/routes/onboarding/components/LobeMessage', () => ({
  default: ({ sentences }: { sentences: string[] }) => <div>{sentences.join(' / ')}</div>,
}));

vi.mock('../components/ComposioServerList', () => ({
  default: () => <div>ComposioServerList</div>,
}));

afterEach(() => {
  cleanup();
});

describe('ProSettingsStep', () => {
  it('uses the connector title as the step title and renders the Composio server list', () => {
    render(<ProSettingsStep onBack={vi.fn()} onNext={vi.fn()} />);

    expect(screen.getAllByText('Connect Your Favorite Tools')).toHaveLength(1);
    expect(screen.getByText('ComposioServerList')).toBeInTheDocument();
  });

  it('calls the provided navigation handlers', () => {
    const onBack = vi.fn();
    const onNext = vi.fn();

    render(<ProSettingsStep onBack={onBack} onNext={onNext} />);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);

    cleanup();

    render(<ProSettingsStep onBack={onBack} onNext={onNext} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
