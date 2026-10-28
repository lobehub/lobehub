import { describe, expect, it, vi } from 'vitest';

import {
  agentBrowserSessionName,
  buildAgentBrowserCommands,
  READ_PAGE_MAX_CHARS,
  runAgentBrowserCall,
} from './agentBrowser';

const step = (command: string[], result: Record<string, unknown>) => ({
  command,
  error: null,
  result,
  success: true,
});

const run = (apiName: string, args: Record<string, unknown>, steps: unknown[]) => {
  const exec = vi.fn().mockResolvedValue(JSON.stringify(steps));
  const readFile = vi.fn();
  const promise = runAgentBrowserCall(apiName, args, {
    exec,
    readFile,
    screenshotPath: '/tmp/shot.png',
  });
  return { exec, promise, readFile };
};

describe('agentBrowserSessionName', () => {
  it('keys the session by topic and strips unsafe characters', () => {
    expect(agentBrowserSessionName('tpc_abc-1')).toBe('lobehub-topic-tpc_abc-1');
    expect(agentBrowserSessionName('../x y')).toBe('lobehub-topic-___x_y');
    expect(agentBrowserSessionName(undefined)).toBe('lobehub-default');
  });
});

describe('buildAgentBrowserCommands', () => {
  it('keeps flag-like text as a literal argv element', () => {
    expect(
      buildAgentBrowserCommands('fill', { ref: 'e1', submit: true, text: '--headed' }, '/s.png'),
    ).toEqual([
      ['fill', '@e1', '--headed'],
      ['press', 'Enter'],
    ]);
  });

  it('accepts the ref spellings a model copies from a snapshot', () => {
    for (const ref of ['e12', '@e12', '[ref=e12]']) {
      expect(buildAgentBrowserCommands('click', { ref }, '/s.png')[0]).toEqual(['click', '@e12']);
    }
  });

  it('clicks by coordinates with a mouse press', () => {
    expect(buildAgentBrowserCommands('click', { x: 10, y: 20 }, '/s.png').slice(0, 3)).toEqual([
      ['mouse', 'move', '10', '20'],
      ['mouse', 'down'],
      ['mouse', 'up'],
    ]);
  });

  it('scrolls with the wheel, defaulting dx to 0', () => {
    expect(buildAgentBrowserCommands('scroll', { dy: 300 }, '/s.png')).toEqual([
      ['mouse', 'wheel', '300', '0'],
    ]);
  });

  it.each([
    ['navigate', { url: 'file:///etc/passwd' }, 'absolute http(s) URL'],
    ['click', { ref: 'body' }, 'Invalid ref'],
    ['click', {}, 'x must be a number'],
    ['fill', { ref: 'e1' }, 'text is required'],
    ['unknown', {}, 'not available on this device'],
  ])('rejects %s %j', (apiName, args, message) => {
    expect(() => buildAgentBrowserCommands(apiName, args, '/s.png')).toThrow(message);
  });
});

describe('runAgentBrowserCall', () => {
  it('runs in the topic session without forwarding the run identity', async () => {
    const { exec, promise } = run(
      'navigate',
      { __agentId: 'agt', __topicId: 'tpc', url: 'https://example.com' },
      [step(['open'], { title: 'Example Domain', url: 'https://example.com/' })],
    );

    await expect(promise).resolves.toEqual({
      content: 'Opened https://example.com/ — "Example Domain".',
      state: { title: 'Example Domain', url: 'https://example.com/' },
      success: true,
    });
    expect(exec).toHaveBeenCalledWith('lobehub-topic-tpc', [['open', 'https://example.com']]);
  });

  it('returns the snapshot with the page header', async () => {
    const { promise } = run('snapshot', {}, [
      step(['snapshot'], { snapshot: '- link "Learn more" [ref=e1]' }),
      step(['get', 'title'], { title: 'Example' }),
      step(['get', 'url'], { url: 'https://example.com/' }),
    ]);

    await expect(promise).resolves.toMatchObject({
      content: 'Page: Example (https://example.com/)\n- link "Learn more" [ref=e1]',
      state: { snapshot: '- link "Learn more" [ref=e1]', title: 'Example' },
      success: true,
    });
  });

  it('caps readPage like the desktop', async () => {
    const { promise } = run('readPage', {}, [
      step(['read'], { content: 'a'.repeat(READ_PAGE_MAX_CHARS + 10) }),
      step(['get', 'title'], { title: 'T' }),
      step(['get', 'url'], { url: 'https://u/' }),
    ]);

    const result = await promise;
    expect((result.state as { content: string }).content).toHaveLength(READ_PAGE_MAX_CHARS);
  });

  it('returns the screenshot as a PNG data URL with its size', async () => {
    const png = new Uint8Array(24);
    const view = new DataView(png.buffer);
    view.setUint32(16, 1280);
    view.setUint32(20, 720);
    const { promise, readFile } = run('screenshot', {}, [
      step(['screenshot'], { path: '/tmp/shot.png' }),
    ]);
    readFile.mockResolvedValue(png);

    const result = await promise;
    expect(readFile).toHaveBeenCalledWith('/tmp/shot.png');
    expect(result).toMatchObject({ state: { height: 720, width: 1280 }, success: true });
    expect((result.state as { dataUrl: string }).dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  // `agent-browser fill` on a native <select> reports success but leaves the
  // select blank, so the manifest's "option value or visible label" promise
  // was silently broken on CLI devices.
  it('fills a native select through `select`', async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify([step(['get', 'html'], { html: '<option value="b">Banana</option>' })]),
      )
      .mockResolvedValueOnce(JSON.stringify([step(['select'], { selected: ['Banana'] })]));

    const result = await runAgentBrowserCall(
      'fill',
      { __topicId: 't', ref: 'e5', text: 'Banana' },
      { exec, readFile: vi.fn(), screenshotPath: '/s.png' },
    );

    expect(exec).toHaveBeenNthCalledWith(1, 'lobehub-topic-t', [['get', 'html', '@e5']]);
    expect(exec).toHaveBeenNthCalledWith(2, 'lobehub-topic-t', [['select', '@e5', 'Banana']]);
    expect(result).toMatchObject({ content: 'Selected e5 with "Banana".', success: true });
  });

  it('fills a text field through `fill`', async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify([step(['get', 'html'], { html: '' })]))
      .mockResolvedValueOnce(JSON.stringify([step(['fill'], { filled: '@e6' })]));

    await runAgentBrowserCall(
      'fill',
      { ref: 'e6', text: 'hello' },
      { exec, readFile: vi.fn(), screenshotPath: '/s.png' },
    );

    expect(exec).toHaveBeenNthCalledWith(2, 'lobehub-default', [['fill', '@e6', 'hello']]);
  });

  it('reports the failing step', async () => {
    const { promise } = run('click', { ref: 'e99' }, [
      { command: ['click', '@e99'], error: 'Unknown ref: e99', result: null, success: false },
    ]);

    await expect(promise).resolves.toEqual({
      content: '',
      error: 'Unknown ref: e99',
      success: false,
    });
  });

  it('fails on unreadable output', async () => {
    const exec = vi.fn().mockResolvedValue('Chrome not found');
    await expect(
      runAgentBrowserCall('snapshot', {}, { exec, readFile: vi.fn(), screenshotPath: '/s.png' }),
    ).resolves.toMatchObject({
      error: expect.stringContaining('Chrome not found'),
      success: false,
    });
  });
});
