import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { confirmAppMessage, confirmAppToolCall } from './confirm';

interface OpenedModal {
  close: ReturnType<typeof vi.fn>;
  onOpenChange: (open: boolean) => void;
}

const { createModal, opened } = vi.hoisted(() => {
  const opened: OpenedModal[] = [];
  const createModal = vi.fn((options: { onOpenChange: (open: boolean) => void }) => {
    const modal = { close: vi.fn(), onOpenChange: options.onOpenChange };
    opened.push(modal);
    return modal;
  });
  return { createModal, opened };
});

vi.mock('@lobehub/ui', () => ({
  Button: () => null,
  createModal,
  Flexbox: () => null,
  Highlighter: () => null,
  Text: () => null,
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const toolCall = (signal?: AbortSignal) =>
  confirmAppToolCall({ appName: 'Weather Demo', args: {}, signal, tool: 'get_forecast' });

describe('MCP App confirm queue', () => {
  beforeEach(() => {
    opened.length = 0;
    createModal.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens one modal at a time across views', async () => {
    const first = toolCall();
    const second = confirmAppMessage({ appName: 'Other View', text: 'hi' });
    await flush();
    expect(opened).toHaveLength(1);

    opened[0].onOpenChange(false);
    await expect(first).resolves.toBe(false);
    await flush();
    expect(opened).toHaveLength(2);

    opened[1].onOpenChange(false);
    await expect(second).resolves.toBe(false);
  });

  it('drops a waiting request at once when its view goes away, without opening it', async () => {
    const first = toolCall();
    const view = new AbortController();
    const second = toolCall(view.signal);
    await flush();

    view.abort();
    await expect(second).resolves.toBe(false);

    opened[0].onOpenChange(false);
    await first;
    await flush();
    expect(opened).toHaveLength(1);
  });

  it('closes a shown modal when its view goes away', async () => {
    const view = new AbortController();
    const pending = toolCall(view.signal);
    await flush();
    expect(opened).toHaveLength(1);

    view.abort();
    await expect(pending).resolves.toBe(false);
    expect(opened[0].close).toHaveBeenCalled();

    // The queue moves on to the next request
    const next = toolCall();
    await flush();
    expect(opened).toHaveLength(2);
    opened[1].onOpenChange(false);
    await next;
  });

  it('asks with a signal in browsers without Promise.withResolvers', async () => {
    vi.spyOn(Promise, 'withResolvers').mockImplementation(() => {
      throw new TypeError('Promise.withResolvers is not a function');
    });
    const view = new AbortController();

    const pending = toolCall(view.signal);
    await flush();
    expect(opened).toHaveLength(1);

    opened[0].onOpenChange(false);
    await expect(pending).resolves.toBe(false);
  });

  it('leaves no abort listener on the signal once a request is answered', async () => {
    const view = new AbortController();
    const added = vi.spyOn(view.signal, 'addEventListener');
    const removed = vi.spyOn(view.signal, 'removeEventListener');

    const pending = toolCall(view.signal);
    await flush();
    opened[0].onOpenChange(false);
    await expect(pending).resolves.toBe(false);

    const listeners = (spy: typeof added) => spy.mock.calls.map(([, listener]) => listener);
    expect(listeners(added).length).toBeGreaterThan(0);
    expect(listeners(removed)).toEqual(expect.arrayContaining(listeners(added)));
  });
});
