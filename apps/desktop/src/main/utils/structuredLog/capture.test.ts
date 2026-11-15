import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  captureMainConsole,
  captureRendererLogs,
  rawConsole,
  recordRendererConsoleMessage,
} from './capture';
import * as sink from './sink';

let write: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  write = vi.spyOn(sink, 'writeStructuredLog').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('recordRendererConsoleMessage', () => {
  it('maps the Chromium level, the [Tag] namespace and a query-free source', () => {
    recordRendererConsoleMessage('w3', {
      level: 'warning',
      lineNumber: 12,
      message: '[Gateway] Auth failed for operation op_1_a',
      sourceId: 'http://localhost:9926/src/store/gateway.ts?t=123&token=secret',
    });

    expect(write).toHaveBeenCalledWith({
      level: 'warn',
      message: 'Auth failed for operation op_1_a',
      ns: 'renderer:w3:Gateway',
      process: 'renderer',
      source: '/src/store/gateway.ts:12',
    });
  });
});

describe('captureRendererLogs', () => {
  it('records app windows only, not webview guests', () => {
    const app = new EventEmitter();
    captureRendererLogs(app as never);

    const createContents = (type: string, id: number) =>
      Object.assign(new EventEmitter(), { getType: () => type, id });
    const window = createContents('window', 1);
    const webview = createContents('webview', 2);
    app.emit('web-contents-created', {}, window);
    app.emit('web-contents-created', {}, webview);

    const details = { level: 'info', lineNumber: 1, message: 'hello', sourceId: '' };
    window.emit('console-message', details);
    webview.emit('console-message', details);
    window.emit('render-process-gone', {}, { exitCode: 1, reason: 'crashed' });

    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenNthCalledWith(1, expect.objectContaining({ ns: 'renderer:w1' }));
    expect(write).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        level: 'error',
        message: 'renderer w1 gone: crashed',
        process: 'main',
      }),
    );
  });
});

describe('captureMainConsole', () => {
  it('mirrors direct console calls once, and rawConsole bypasses the mirror', () => {
    const saved = { ...console };
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      captureMainConsole();
      console.info('[Menu] Opening logs', { path: '/tmp' });
      rawConsole.error('already recorded');

      expect(info).toHaveBeenCalledWith('[Menu] Opening logs', { path: '/tmp' });
      expect(error).toHaveBeenCalledWith('already recorded');
      expect(write).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledWith({
        args: [{ path: '/tmp' }],
        level: 'info',
        message: 'Opening logs',
        ns: 'Menu',
        process: 'main',
      });
    } finally {
      Object.assign(console, saved);
    }
  });
});
