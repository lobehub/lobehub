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

/** The `focus` and page-probe answers for a `fill` target that is an ordinary field. */
const notACodeEditor = [
  JSON.stringify([step(['focus'], {})]),
  JSON.stringify([step(['eval'], { result: JSON.stringify({ isEditor: false }) })]),
];

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

  // agent-browser answered success for any key name, so a typo or an unknown
  // key reached the model as a key press that never happened.
  it('presses a normalized combo and rejects unknown keys', () => {
    expect(buildAgentBrowserCommands('press', { key: 'ctrl+shift+down' }, '/s.png')).toEqual([
      ['press', 'Control+Shift+ArrowDown'],
    ]);
    expect(() => buildAgentBrowserCommands('press', { key: 'Bogus+Key' }, '/s.png')).toThrow(
      'Unknown modifier "Bogus"',
    );
  });

  // Headless Chrome on macOS sends Meta+A to the page but never selects anything.
  it('runs the macOS editing command behind Meta shortcuts', () => {
    expect(
      buildAgentBrowserCommands('press', { key: 'ControlOrMeta+a' }, '/s.png', {
        platform: 'darwin',
      }),
    ).toEqual([
      ['press', 'Meta+a'],
      ['eval', 'document.execCommand("selectAll")'],
    ]);
    expect(
      buildAgentBrowserCommands('press', { key: 'ControlOrMeta+a' }, '/s.png', {
        platform: 'linux',
      }),
    ).toEqual([['press', 'Control+a']]);
  });

  it('sets the viewport, or restores the default without a size', () => {
    expect(
      buildAgentBrowserCommands('setViewport', { height: 900, width: 1440 }, '/s.png'),
    ).toEqual([['set', 'viewport', '1440', '900']]);
    expect(buildAgentBrowserCommands('setViewport', {}, '/s.png')).toEqual([
      ['set', 'viewport', '1280', '720'],
    ]);
  });

  it.each([
    ['navigate', { url: 'file:///etc/passwd' }, 'absolute http(s) URL'],
    ['click', { ref: 'body' }, 'Invalid ref'],
    ['click', {}, 'x must be a number'],
    ['fill', { ref: 'e1' }, 'text is required'],
    ['press', {}, 'key is required'],
    ['setViewport', { width: 1440 }, 'height must be'],
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
      step(['eval'], { result: '[]' }),
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
      step(['eval'], { result: '[]' }),
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
      .mockResolvedValueOnce(notACodeEditor[0])
      .mockResolvedValueOnce(notACodeEditor[1])
      .mockResolvedValueOnce(
        JSON.stringify([step(['get', 'html'], { html: '<option value="b">Banana</option>' })]),
      )
      .mockResolvedValueOnce(JSON.stringify([step(['select'], { selected: ['Banana'] })]));

    const result = await runAgentBrowserCall(
      'fill',
      { __topicId: 't', ref: 'e5', text: 'Banana' },
      { exec, readFile: vi.fn(), screenshotPath: '/s.png' },
    );

    expect(exec).toHaveBeenNthCalledWith(3, 'lobehub-topic-t', [['get', 'html', '@e5']]);
    expect(exec).toHaveBeenNthCalledWith(4, 'lobehub-topic-t', [['select', '@e5', 'Banana']]);
    expect(result).toMatchObject({ content: 'Selected e5 with "Banana".', success: true });
  });

  it('fills a text field through `fill`', async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce(notACodeEditor[0])
      .mockResolvedValueOnce(notACodeEditor[1])
      .mockResolvedValueOnce(JSON.stringify([step(['get', 'html'], { html: '' })]))
      .mockResolvedValueOnce(JSON.stringify([step(['fill'], { filled: '@e6' })]));

    await runAgentBrowserCall(
      'fill',
      { ref: 'e6', text: 'hello' },
      { exec, readFile: vi.fn(), screenshotPath: '/s.png' },
    );

    expect(exec).toHaveBeenNthCalledWith(4, 'lobehub-default', [['fill', '@e6', 'hello']]);
  });

  describe('on a Monaco editor', () => {
    /** A page whose focused element is a Monaco input backed by `doc`. */
    const monacoExec = (initial: string) => {
      const page = { doc: initial };
      const exec = vi.fn(async (_session: string, commands: string[][]) => {
        const [name, script = ''] = commands[0];
        if (name !== 'eval') return JSON.stringify([step(commands[0], {})]);
        let result: unknown = JSON.stringify({ hasApi: true, isEditor: true, readOnly: false });
        if (script.includes('executeEdits')) {
          const [, start, end, text] = script.match(/\}\)\((\d+), (\d+), (".*")\)$/s)!;
          page.doc = page.doc.slice(0, +start) + JSON.parse(text) + page.doc.slice(+end);
          result = JSON.stringify({ ok: true });
        } else if (script.includes('text: bound ?')) {
          result = JSON.stringify({ text: page.doc });
        }
        return JSON.stringify([step(commands[0], { result })]);
      });
      return { exec, page };
    };

    // `agent-browser fill` set the hidden input's value, which Monaco read as
    // typing over its text: `const raw=false;` became `onese;`.
    it('edits through the editor and never fills its hidden input', async () => {
      const { exec, page } = monacoExec('const raw=false;\n');

      const result = await runAgentBrowserCall(
        'fill',
        { oldText: 'raw=false', ref: 'e1', text: 'raw=true' },
        { exec: exec as any, readFile: vi.fn(), screenshotPath: '/s.png' },
      );

      expect(result).toMatchObject({ success: true });
      expect(page.doc).toBe('const raw=true;\n');
      expect(exec.mock.calls.some(([, commands]) => commands[0][0] === 'fill')).toBe(false);
    });

    it('refuses a printable key while focus is in the code', async () => {
      const exec = vi.fn().mockResolvedValue(JSON.stringify([step(['eval'], { result: true })]));

      const result = await runAgentBrowserCall(
        'press',
        { key: 'o' },
        { exec, readFile: vi.fn(), screenshotPath: '/s.png' },
      );

      expect(result).toMatchObject({
        error: expect.stringContaining('would be typed into the code'),
        success: false,
      });
      expect(exec).toHaveBeenCalledTimes(1);
      expect(exec.mock.calls[0][1][0][0]).toBe('eval');
    });

    it.each(['Escape', 'Alt+F1', 'ControlOrMeta+End'])('still sends %s', async (key) => {
      const exec = vi.fn().mockResolvedValue(JSON.stringify([step(['press'], {})]));

      await expect(
        runAgentBrowserCall(
          'press',
          { key },
          { exec, platform: 'linux', readFile: vi.fn(), screenshotPath: '/s.png' },
        ),
      ).resolves.toMatchObject({ success: true });
      expect(exec).toHaveBeenCalledTimes(1);
      expect(exec.mock.calls[0][1][0][0]).toBe('press');
    });

    it('appends the exact code to readPage', async () => {
      const editors = [{ complete: true, language: 'ts', lines: 1, text: 'const a = 1;' }];
      const { promise } = run('readPage', {}, [
        step(['read'], { content: 'Page text' }),
        step(['eval'], { result: JSON.stringify(editors) }),
        step(['get', 'title'], { title: 'T' }),
        step(['get', 'url'], { url: 'https://u/' }),
      ]);

      expect((await promise).content).toContain(
        '--- code editor 1 (monaco, ts, 1 lines) ---\nconst a = 1;\n--- end of code editor 1 ---',
      );
    });
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

  it('reports a macOS editing command the page refused', async () => {
    const exec = vi
      .fn()
      .mockResolvedValue(
        JSON.stringify([step(['press'], { pressed: 'Meta+v' }), step(['eval'], { result: false })]),
      );

    await expect(
      runAgentBrowserCall(
        'press',
        { key: 'Meta+v' },
        { exec, platform: 'darwin', readFile: vi.fn(), screenshotPath: '/s.png' },
      ),
    ).resolves.toEqual({
      content: 'Pressed Meta+v, but the page did not run paste.',
      success: true,
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
