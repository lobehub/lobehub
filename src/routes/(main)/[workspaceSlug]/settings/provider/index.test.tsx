import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import WorkspaceProviderSetting from './index';

vi.mock('@/routes/(main)/settings/provider/(list)', async () => {
  const { useSettingsContext } = await import('@/routes/(main)/settings/_layout/ContextProvider');

  const ProviderList = () => {
    const { showOpenAIApiKey, showOpenAIProxyUrl } = useSettingsContext();

    return (
      <div data-testid="provider-context">
        {String(showOpenAIApiKey)}:{String(showOpenAIProxyUrl)}
      </div>
    );
  };

  return { default: ProviderList };
});

describe('WorkspaceProviderSetting', () => {
  it('provides settings context for the reused provider settings page', () => {
    render(<WorkspaceProviderSetting />);

    expect(screen.getByTestId('provider-context')).toHaveTextContent('true:true');
  });
});
