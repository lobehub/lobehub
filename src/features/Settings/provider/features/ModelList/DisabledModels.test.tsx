import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiModelService } from '@/services/aiModel';

import DisabledModels from './DisabledModels';

const models = Array.from({ length: 40 }, (_, i) => ({
  enabled: false,
  id: `model-${i}`,
  type: 'chat',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/store/aiInfra', () => ({
  useAiInfraStore: (selector: (s: any) => unknown) => selector({ disabledModels: models }),
}));

vi.mock('@/store/aiInfra/selectors', () => ({
  aiModelSelectors: {
    disabledAiProviderModelList: (s: any) => s.disabledModels,
  },
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (s: any) => unknown) =>
    selector({ status: { disabledModelsSortType: 'default' }, updateSystemStatus: vi.fn() }),
}));

vi.mock('./ModelItem', () => ({
  default: ({ id }: { id: string }) => <div data-testid="model-item">{id}</div>,
}));

describe('DisabledModels', () => {
  let intersect: (() => void) | undefined;

  beforeEach(() => {
    intersect = undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersect = () =>
            callback(
              [{ isIntersecting: true } as IntersectionObserverEntry],
              this as unknown as IntersectionObserver,
            );
        }
        disconnect() {}
        observe() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders every disabled model from the model-list replica without fetching pages', async () => {
    const serviceSpy = vi.spyOn(aiModelService, 'getAiProviderModelList').mockResolvedValue([]);

    render(<DisabledModels activeTab="all" providerId="openai" />);

    // First paint is windowed
    expect(screen.getAllByTestId('model-item')).toHaveLength(30);

    // Scrolling reveals the rest of the rows already in the replica
    act(() => intersect?.());
    expect(screen.getAllByTestId('model-item')).toHaveLength(40);

    // Reaching the end must not refetch rows the replica already holds
    act(() => intersect?.());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(serviceSpy).not.toHaveBeenCalled();
  });
});
