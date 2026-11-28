import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiModelService } from '@/services/aiModel';

import DisabledModels from './DisabledModels';

let mockModels = Array.from({ length: 40 }, (_, i) => ({
  displayName: `Model ${String(i).padStart(2, '0')}`,
  enabled: false,
  id: `model-${i}`,
  type: 'chat',
}));
let mockSortType = 'default';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/store/aiInfra', () => ({
  useAiInfraStore: (selector: (s: any) => unknown) => selector({ disabledModels: mockModels }),
}));

vi.mock('@/store/aiInfra/selectors', () => ({
  aiModelSelectors: {
    disabledAiProviderModelList: (s: any) => s.disabledModels,
  },
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (s: any) => unknown) =>
    selector({ status: { disabledModelsSortType: mockSortType }, updateSystemStatus: vi.fn() }),
}));

vi.mock('./ModelItem', () => ({
  default: ({ id }: { id: string }) => <div data-testid="model-item">{id}</div>,
}));

describe('DisabledModels', () => {
  let intersect: (() => void) | undefined;

  beforeEach(() => {
    mockSortType = 'default';
    mockModels = Array.from({ length: 40 }, (_, i) => ({
      displayName: `Model ${String(i).padStart(2, '0')}`,
      enabled: false,
      id: `model-${i}`,
      type: 'chat',
    }));
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

  it('filters by activeTab before slicing so models beyond the first 30 entries are visible immediately', () => {
    mockModels = [
      ...Array.from({ length: 50 }, (_, i) => ({
        displayName: `Chat ${i}`,
        enabled: false,
        id: `chat-${i}`,
        type: 'chat',
      })),
      ...Array.from({ length: 26 }, (_, i) => ({
        displayName: `Image ${i}`,
        enabled: false,
        id: `image-${i}`,
        type: 'image',
      })),
    ];

    render(<DisabledModels activeTab="image" providerId="aihubmix" />);

    const items = screen.getAllByTestId('model-item');
    expect(items).toHaveLength(26);
    expect(items[0].textContent).toBe('image-0');
    expect(items[25].textContent).toBe('image-25');
  });

  it('sorts across the entire filtered model list before slicing the first page', () => {
    mockSortType = 'alphabetical';
    mockModels = [
      ...Array.from({ length: 35 }, (_, i) => ({
        displayName: `Zeta ${String(i).padStart(2, '0')}`,
        enabled: false,
        id: `zeta-${i}`,
        type: 'chat',
      })),
      {
        displayName: 'Alpha First',
        enabled: false,
        id: 'alpha-first',
        type: 'chat',
      },
    ];

    render(<DisabledModels activeTab="all" providerId="aihubmix" />);

    const items = screen.getAllByTestId('model-item');
    expect(items).toHaveLength(30);
    expect(items[0].textContent).toBe('alpha-first');
  });

  it('resets visible window when switching tabs and hides the section when the active tab has no disabled models', () => {
    mockModels = [
      ...Array.from({ length: 40 }, (_, i) => ({
        displayName: `Chat ${i}`,
        enabled: false,
        id: `chat-${i}`,
        type: 'chat',
      })),
      ...Array.from({ length: 35 }, (_, i) => ({
        displayName: `Image ${i}`,
        enabled: false,
        id: `image-${i}`,
        type: 'image',
      })),
    ];

    const { rerender } = render(<DisabledModels activeTab="chat" providerId="aihubmix" />);
    expect(screen.getAllByTestId('model-item')).toHaveLength(30);
    act(() => intersect?.());
    expect(screen.getAllByTestId('model-item')).toHaveLength(40);

    // Switching to another tab resets pagination back to PAGE_SIZE (30)
    rerender(<DisabledModels activeTab="image" providerId="aihubmix" />);
    expect(screen.getAllByTestId('model-item')).toHaveLength(30);
    act(() => intersect?.());
    expect(screen.getAllByTestId('model-item')).toHaveLength(35);

    // Switching to a tab with no disabled models hides the Disabled section cleanly
    rerender(<DisabledModels activeTab="video" providerId="aihubmix" />);
    expect(screen.queryByTestId('model-item')).toBeNull();
    expect(screen.queryByText('providerModels.list.disabled')).toBeNull();
  });
});
