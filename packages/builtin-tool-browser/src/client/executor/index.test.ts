import { beforeEach, describe, expect, it, vi } from 'vitest';

const snapshot = vi.fn();

vi.mock('@/services/electron/browserControl', () => ({
  electronBrowserControlService: { snapshot },
}));

const ctx = { agentId: 'agt_1', topicId: 'tpc_1' } as any;

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

describe('browserExecutor session key', () => {
  beforeEach(() => {
    snapshot.mockReset();
    snapshot.mockResolvedValue({ snapshot: '', success: true });
  });

  it('keeps a topic run on the topic page', async () => {
    const { browserExecutor } = await import('./index');

    await browserExecutor.snapshot({}, ctx);

    expect(snapshot).toHaveBeenCalledWith({ sessionId: 'topic:tpc_1' });
  });

  it('keeps a thread the user opened on the topic page the panel shows', async () => {
    const { browserExecutor } = await import('./index');

    await browserExecutor.snapshot({}, { ...ctx, threadId: 'thd_user' });

    expect(snapshot).toHaveBeenCalledWith({ sessionId: 'topic:tpc_1' });
  });

  it('gives each sub-agent thread its own page', async () => {
    const { browserExecutor } = await import('./index');

    await browserExecutor.snapshot({}, { ...ctx, isSubAgent: true, threadId: 'thd_a' });
    await browserExecutor.snapshot({}, { ...ctx, isSubAgent: true, threadId: 'thd_b' });

    expect(snapshot).toHaveBeenNthCalledWith(1, { sessionId: 'topic:tpc_1:thread:thd_a' });
    expect(snapshot).toHaveBeenNthCalledWith(2, { sessionId: 'topic:tpc_1:thread:thd_b' });
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
