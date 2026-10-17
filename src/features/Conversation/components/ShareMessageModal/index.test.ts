import { beforeEach, describe, expect, it, vi } from 'vitest';

const createShareMessageModal = vi.hoisted(() => vi.fn(() => ({ close: vi.fn() })));
const notifyChunkError = vi.hoisted(() => vi.fn());
// Detection belongs to `@/utils/chunkError` (and its own tests); a mocked
// import's rejection is wrapped by vitest, so the facade test decides it here.
const isChunkLoadError = vi.hoisted(() => vi.fn(() => false));

vi.mock('@/utils/chunkError', () => ({ isChunkLoadError, notifyChunkError }));

// The facade keeps module state (the loading import, the pending open), so
// every test starts from a fresh module graph.
const loadFacade = async (
  modal: () => object = () => ({ openShareMessageModal: createShareMessageModal }),
) => {
  vi.resetModules();
  vi.doMock('./Modal', modal);
  return import('./index');
};

describe('openShareMessageModal', () => {
  beforeEach(() => {
    createShareMessageModal.mockClear();
    notifyChunkError.mockClear();
    isChunkLoadError.mockReset().mockReturnValue(false);
  });

  it('opens the lazily loaded modal with the message and its store', async () => {
    const { openShareMessageModal } = await loadFacade();
    const message = { id: 'msg-1' } as any;
    const createStore = vi.fn();

    const instance = await openShareMessageModal(message, createStore);

    expect(createShareMessageModal).toHaveBeenCalledWith(message, createStore);
    expect(instance).toBe(createShareMessageModal.mock.results[0].value);
  });

  it('loads the modal module once', async () => {
    const { preloadShareMessageModal } = await loadFacade();

    expect(preloadShareMessageModal()).toBe(preloadShareMessageModal());
  });

  // Before the chunk arrives every click awaits the same import; each must not
  // stack its own modal once it resolves.
  it('opens one modal for clicks made while the chunk is loading', async () => {
    const { openShareMessageModal } = await loadFacade();
    const message = { id: 'msg-1' } as any;

    const first = openShareMessageModal(message, vi.fn());
    const second = openShareMessageModal(message, vi.fn());

    expect(await second).toBe(await first);
    expect(createShareMessageModal).toHaveBeenCalledTimes(1);
  });

  it('opens a new modal for a click after the previous one settled', async () => {
    const { openShareMessageModal } = await loadFacade();

    await openShareMessageModal({ id: 'msg-1' } as any, vi.fn());
    await openShareMessageModal({ id: 'msg-2' } as any, vi.fn());

    expect(createShareMessageModal).toHaveBeenCalledTimes(2);
  });

  it('hands a chunk that failed to load to the chunk recovery instead of rejecting', async () => {
    isChunkLoadError.mockReturnValue(true);
    const { openShareMessageModal } = await loadFacade(() => {
      throw new TypeError('Failed to fetch dynamically imported module: /assets/Modal.js');
    });

    await expect(openShareMessageModal({ id: 'msg-1' } as any, vi.fn())).resolves.toBeUndefined();
    expect(notifyChunkError).toHaveBeenCalledTimes(1);
  });

  it('still surfaces errors that are not chunk-load failures', async () => {
    const { openShareMessageModal } = await loadFacade(() => ({
      openShareMessageModal: () => {
        throw new Error('modal bug');
      },
    }));

    await expect(openShareMessageModal({ id: 'msg-1' } as any, vi.fn())).rejects.toThrow(
      'modal bug',
    );
    expect(notifyChunkError).not.toHaveBeenCalled();
  });
});
