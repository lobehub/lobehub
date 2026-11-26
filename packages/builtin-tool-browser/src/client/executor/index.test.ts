import { beforeEach, describe, expect, it, vi } from 'vitest';

const snapshot = vi.fn();
const screenshot = vi.fn();

vi.mock('@/services/electron/browserControl', () => ({
  electronBrowserControlService: { screenshot, snapshot },
}));

vi.mock('@/store/agent', () => ({ useAgentStore: { getState: () => ({}) } }));
vi.mock('@/store/chat', () => ({ useChatStore: { getState: () => ({}) } }));
vi.mock('@/store/global', () => ({ useGlobalStore: { getState: () => ({}) } }));

const ctx = { agentId: 'agt_1', topicId: 'tpc_1' } as any;

describe('browserExecutor.screenshot', () => {
  // The context engine builds the model's image part from `state.images`; with
  // only `dataUrl` the model received the "captured" sentence and no picture.
  it('returns the capture where the model can see it', async () => {
    const dataUrl = 'data:image/jpeg;base64,abc';
    screenshot.mockResolvedValue({ dataUrl, height: 600, success: true, width: 800 });
    const { browserExecutor } = await import('./index');

    const result = await browserExecutor.screenshot({}, ctx);

    expect(result.state).toEqual({
      height: 600,
      images: [{ mediaType: 'image/jpeg', url: dataUrl }],
      width: 800,
    });
  });
});

describe('browserExecutor.snapshot', () => {
  beforeEach(() => {
    snapshot.mockReset();
  });

  it('reports a page with no interactive elements as a successful, empty snapshot', async () => {
    // e.g. an image URL or a JSON API response: the page loaded fine, there is
    // just nothing to list.
    snapshot.mockResolvedValue({
      snapshot: '',
      success: true,
      title: 'api.printful.com/products/19',
      url: 'https://api.printful.com/products/19',
    });
    const { browserExecutor } = await import('./index');

    const result = await browserExecutor.snapshot({}, ctx);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.content).toContain(
      'Page: api.printful.com/products/19 (https://api.printful.com/products/19)',
    );
    expect(result.content).toContain('No interactive elements');
    expect(result.content).toContain('readPage');
  });

  it('still lists elements when the page has them', async () => {
    snapshot.mockResolvedValue({
      snapshot: '- button "Continue" [ref=e1]',
      success: true,
      title: 'Login',
      url: 'http://127.0.0.1:8099/login',
    });
    const { browserExecutor } = await import('./index');

    const result = await browserExecutor.snapshot({}, ctx);

    expect(result).toMatchObject({ success: true });
    expect(result.content).toBe(
      'Page: Login (http://127.0.0.1:8099/login)\n- button "Continue" [ref=e1]',
    );
  });

  it('keeps surfacing a real snapshot failure', async () => {
    snapshot.mockResolvedValue({
      error: 'Browser is not open for this conversation',
      success: false,
    });
    const { browserExecutor } = await import('./index');

    const result = await browserExecutor.snapshot({}, ctx);

    expect(result.success).toBe(false);
    expect(result.content).toBe('Browser is not open for this conversation');
  });
});

describe('browserExecutor.setViewport', () => {
  const setViewport = vi.fn();

  beforeEach(async () => {
    setViewport.mockReset();
    const { electronBrowserControlService } = await import('@/services/electron/browserControl');
    Object.assign(electronBrowserControlService, { setViewport });
  });

  it('tells the model the panel shows the viewport scaled down', async () => {
    setViewport.mockResolvedValue({ scale: 0.28, success: true });
    const { browserExecutor } = await import('./index');

    const result = await browserExecutor.setViewport({ height: 900, width: 1440 }, ctx);

    expect(setViewport).toHaveBeenCalledWith({
      height: 900,
      sessionId: 'topic:tpc_1',
      width: 1440,
    });
    expect(result).toMatchObject({ success: true });
    expect(result.content).toBe(
      'Viewport set to 1440×900. The panel shows it at 28%, so screenshots come out at that scale.',
    );
  });

  it('resets to the panel size without a size', async () => {
    setViewport.mockResolvedValue({ scale: 1, success: true });
    const { browserExecutor } = await import('./index');

    const result = await browserExecutor.setViewport({}, ctx);

    expect(result.content).toBe('Viewport reset to the browser panel size.');
  });

  it('surfaces an invalid size', async () => {
    setViewport.mockResolvedValue({ error: 'width must be a whole number', success: false });
    const { browserExecutor } = await import('./index');

    const result = await browserExecutor.setViewport({ height: 900, width: 10 }, ctx);

    expect(result).toMatchObject({
      error: { message: 'width must be a whole number' },
      success: false,
    });
  });
});
