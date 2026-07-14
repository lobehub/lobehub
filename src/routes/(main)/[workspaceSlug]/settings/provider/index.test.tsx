import { render, screen } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import WorkspaceProviderSetting from './index';

vi.mock('@/const/version', () => ({ isCustomBranding: false }));

vi.mock('@/routes/(main)/settings/provider/_layout/Desktop', () => ({
  default: ({ children }: PropsWithChildren) => <>{children}</>,
}));

vi.mock('@/routes/(main)/settings/provider/_layout/Mobile', () => ({
  default: ({ children }: PropsWithChildren) => <>{children}</>,
}));

vi.mock('@/routes/(main)/settings/provider/detail', async () => {
  const { useSettingsContext } = await import('@/routes/(main)/settings/_layout/ContextProvider');

  const ProviderDetail = () => {
    const { showOpenAIApiKey, showOpenAIProxyUrl } = useSettingsContext();

    return (
      <div data-testid="provider-context">
        {String(showOpenAIApiKey)}:{String(showOpenAIProxyUrl)}
      </div>
    );
  };

  return { default: ProviderDetail };
});

vi.mock('@/routes/(main)/settings/provider/(list)/Footer', () => ({
  default: () => <div data-testid="provider-footer" />,
}));

const renderPage = (providerId: string) =>
  render(
    <MemoryRouter initialEntries={[`/?provider=${providerId}`]}>
      <WorkspaceProviderSetting />
    </MemoryRouter>,
  );

describe('WorkspaceProviderSetting', () => {
  it('provides settings context for the reused provider settings page', () => {
    renderPage('openai');

    expect(screen.getByTestId('provider-context')).toHaveTextContent('true:true');
  });

  it('hides the provider footer for OAuth device flow providers', () => {
    renderPage('supergrok');

    expect(screen.queryByTestId('provider-footer')).not.toBeInTheDocument();
  });

  it('shows the provider footer for regular providers', () => {
    renderPage('openai');

    expect(screen.getByTestId('provider-footer')).toBeInTheDocument();
  });
});
