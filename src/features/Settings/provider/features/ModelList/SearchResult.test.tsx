import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SearchResult from './SearchResult';

const mocks = vi.hoisted(() => ({
  batchToggleAiModels: vi.fn(),
  canManageProvider: false,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values?.count === undefined ? key : `${key}:${values.count}`,
  }),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({
    allowed: mocks.canManageProvider,
    reason: 'requires owner',
  }),
}));

vi.mock('@/store/aiInfra', () => ({
  aiModelSelectors: {
    filteredAiProviderModelList: (s: any) => s.filteredModels,
  },
  useAiInfraStore: (selector: (s: any) => unknown) =>
    selector({
      batchToggleAiModels: mocks.batchToggleAiModels,
      filteredModels: [
        { enabled: false, id: 'gpt-4o', type: 'chat' },
        { enabled: false, id: 'gpt-4.1', type: 'chat' },
      ],
      modelSearchKeyword: 'gpt',
    }),
}));

vi.mock('./ModelItem', () => ({
  default: ({ id }: { id: string }) => <div>{id}</div>,
}));

describe('SearchResult', () => {
  beforeEach(() => {
    mocks.batchToggleAiModels.mockReset();
    mocks.canManageProvider = false;
  });

  it('does not batch-enable models when provider management is denied', () => {
    render(<SearchResult />);

    const enableAllButton = screen.getByRole('button');

    fireEvent.click(enableAllButton);

    expect(mocks.batchToggleAiModels).not.toHaveBeenCalled();
  });

  it('batch-enables filtered models when provider management is allowed', async () => {
    mocks.canManageProvider = true;
    mocks.batchToggleAiModels.mockResolvedValue(undefined);

    render(<SearchResult />);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(mocks.batchToggleAiModels).toHaveBeenCalledWith(['gpt-4o', 'gpt-4.1'], true);
    });
  });
});
