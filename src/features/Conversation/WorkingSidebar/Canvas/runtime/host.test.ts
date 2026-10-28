import { afterEach, expect, it, vi } from 'vitest';

import { attachCanvasRuntime } from './host';

vi.mock('virtual:canvas-runtime', () => ({ default: 'https://app.test/runtime.json' }));

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

it('retains a hidden Activity iframe and releases only when its DOM is removed', async () => {
  let signal: AbortSignal | undefined;
  let loads = 0;
  vi.stubGlobal('fetch', async (_url: URL, options: RequestInit) => {
    loads++;
    signal = options.signal!;
    return Response.json({ bundle: { entries: {}, modules: [], styles: [] } });
  });
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const detach = attachCanvasRuntime(frame, vi.fn());
  await vi.waitFor(() => expect(loads).toBe(1));
  detach();
  expect(signal?.aborted).toBe(false);
  const detachAgain = attachCanvasRuntime(frame, vi.fn());
  expect(loads).toBe(1);
  detachAgain();
  frame.remove();
  await vi.waitFor(() => expect(signal?.aborted).toBe(true));
});
