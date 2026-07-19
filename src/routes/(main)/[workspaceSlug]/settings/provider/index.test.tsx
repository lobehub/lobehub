import { render, screen } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import WorkspaceProviderSetting from './index';

const isOwner = vi.hoisted(() => ({ value: true }));

vi.mock('@/business/client/hooks/useIsWorkspaceOwner', () => ({
  useIsWorkspaceOwner: () => isOwner.value,
}));

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

const renderPage = (providerId: string) =>
  render(
    <MemoryRouter initialEntries={[`/?provider=${providerId}`]}>
      <WorkspaceProviderSetting />
    </MemoryRouter>,
  );

describe('WorkspaceProviderSetting', () => {
  it('provides settings context for the reused provider settings page', () => {
    isOwner.value = true;
    renderPage('openai');

    expect(screen.getByTestId('provider-context')).toHaveTextContent('true:true');
  });

  // The provider roadmap footer was removed from the provider list page in
  // #17217, so the page renders no footer for any provider anymore.
  it('renders no provider footer', () => {
    isOwner.value = true;
    renderPage('openai');

    expect(screen.queryByTestId('provider-footer')).not.toBeInTheDocument();
  });

  it('renders forbidden screen for non-owners', () => {
    isOwner.value = false;
    renderPage('openai');

    expect(screen.queryByTestId('provider-context')).toBeNull();
    expect(screen.getByText('403')).toBeInTheDocument();
  });
});
