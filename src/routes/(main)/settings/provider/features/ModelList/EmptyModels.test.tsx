import { render, screen } from '@testing-library/react';
import { App } from 'antd';
import { describe, expect, it, vi } from 'vitest';

import EmptyModels from './EmptyModels';
import { ProviderSettingsContext } from './ProviderSettingsContext';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({
    allowed: true,
    reason: undefined,
  }),
}));

vi.mock('@/store/aiInfra', () => ({
  useAiInfraStore: (selector: (s: any) => unknown) =>
    selector({
      fetchRemoteModelList: vi.fn(),
    }),
}));

vi.mock('./CreateNewModelModal', () => ({
  createCreateNewModelModal: vi.fn(),
}));

const renderEmptyModels = (context?: { showAddNewModel?: boolean; showModelFetcher?: boolean }) =>
  render(
    <App>
      <ProviderSettingsContext value={context ?? {}}>
        <EmptyModels provider={'lobehub'} />
      </ProviderSettingsContext>
    </App>,
  );

describe('EmptyModels', () => {
  it('shows the fetch and add-model buttons by default', () => {
    renderEmptyModels();

    expect(screen.getByText('providerModels.list.fetcher.fetch')).toBeInTheDocument();
    expect(screen.getByText('providerModels.list.addNew')).toBeInTheDocument();
  });

  it('hides the fetch button when showModelFetcher is false', () => {
    // Regression for LOBE-12051: providers like lobehub disable the model
    // fetcher, but the empty state still offered a fetch action that 500s
    renderEmptyModels({ showModelFetcher: false });

    expect(screen.queryByText('providerModels.list.fetcher.fetch')).toBeNull();
    // the add-model action stays available
    expect(screen.getByText('providerModels.list.addNew')).toBeInTheDocument();
  });

  it('hides the add-model button when showAddNewModel is false', () => {
    // providers like lobehub also disable hand-adding models; the empty state
    // must gate the add action the same way ModelTitle does
    renderEmptyModels({ showAddNewModel: false, showModelFetcher: false });

    expect(screen.queryByText('providerModels.list.addNew')).toBeNull();
    expect(screen.queryByText('providerModels.list.fetcher.fetch')).toBeNull();
  });
});
