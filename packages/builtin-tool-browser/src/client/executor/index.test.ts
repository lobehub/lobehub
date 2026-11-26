import { beforeEach, describe, expect, it, vi } from 'vitest';

const snapshot = vi.fn();

vi.mock('@/services/electron/browserControl', () => ({
  electronBrowserControlService: { snapshot },
}));

// `uploadFile` reveals the panel only for the run the user is looking at.
vi.mock('@/store/agent', () => ({ useAgentStore: { getState: () => ({ activeAgentId: 'x' }) } }));
vi.mock('@/store/chat', () => ({ useChatStore: { getState: () => ({ activeTopicId: 'x' }) } }));
vi.mock('@/store/global', () => ({ useGlobalStore: { getState: () => ({}) } }));

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

describe('browserExecutor.uploadFile', () => {
  const uploadFile = vi.fn();
  const paths = ['/Users/me/Downloads/site.zip'];

  beforeEach(async () => {
    uploadFile.mockReset();
    const { electronBrowserControlService } = await import('@/services/electron/browserControl');
    Object.assign(electronBrowserControlService, { uploadFile });
  });

  it('reports the files the page input holds, with their sizes', async () => {
    uploadFile.mockResolvedValue({
      accept: '.zip',
      files: [{ name: 'site.zip', size: 2_516_582 }],
      success: true,
      title: 'Deploy',
      url: 'https://console.example/deploy',
      via: 'input',
    });
    const { browserExecutor } = await import('./index');

    const result = await browserExecutor.uploadFile({ paths, ref: 'e3' }, ctx);

    expect(uploadFile).toHaveBeenCalledWith({
      paths,
      ref: 'e3',
      selector: undefined,
      sessionId: 'topic:tpc_1',
    });
    expect(result).toMatchObject({
      state: {
        accept: '.zip',
        files: [{ name: 'site.zip', size: 2_516_582 }],
        url: 'https://console.example/deploy',
        via: 'input',
      },
      success: true,
    });
    expect(result.content).toMatch(/^Attached site\.zip \(2\.4 MB\) to the page's file input\./);
  });

  // An agent spent four attempts on a file dialog it could never operate.
  // The answer has to say "ask the user" in a form the agent cannot mistake
  // for a transient failure worth retrying.
  it('returns a structured "user must choose the file" result', async () => {
    uploadFile.mockResolvedValue({
      error: 'The element is not a file input, and clicking it did not open a file chooser.',
      manualSelectionRequired: true,
      success: false,
    });
    const { browserExecutor } = await import('./index');

    const result = await browserExecutor.uploadFile({ paths, ref: 'e8' }, ctx);

    expect(result).toMatchObject({
      error: { type: 'ManualFileSelectionRequired' },
      state: {
        manualSelectionRequired: true,
        paths,
        reason: 'The element is not a file input, and clicking it did not open a file chooser.',
      },
      success: false,
    });
    expect(result.content).toContain('/Users/me/Downloads/site.zip');
    expect(result.content).toContain('Do not retry uploadFile');
  });

  it('keeps a fixable failure an ordinary error', async () => {
    uploadFile.mockResolvedValue({
      error: 'ref not found — take a new snapshot first',
      success: false,
    });
    const { browserExecutor } = await import('./index');

    const result = await browserExecutor.uploadFile({ paths, ref: 'e9' }, ctx);

    expect(result).toMatchObject({
      content: 'ref not found — take a new snapshot first',
      error: { type: 'PluginServerError' },
      success: false,
    });
    expect(result.state).toBeUndefined();
  });
});
