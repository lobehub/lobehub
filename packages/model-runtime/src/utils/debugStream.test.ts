import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { debugStream } from './debugStream';

describe('debugStream', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('should log stream start and end messages', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue('test chunk');
        controller.close();
      },
    });

    await debugStream(stream);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringMatching(/^\[stream start\]/));
  });

  it('should handle and log stream errors', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue('test chunk');
      },
    });

    await debugStream(stream);

    expect(consoleErrorSpy).toHaveBeenCalledWith('[debugStream error]', expect.any(Error));
    expect(consoleErrorSpy).toHaveBeenCalledWith('[error chunk value:]', 'test chunk');
  });

  it('should decode ArrayBuffer chunk values', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('test chunk'));
        controller.close();
      },
    });

    await debugStream(stream);

    expect(consoleLogSpy).toHaveBeenCalledWith('test chunk');
  });

  it('should stringify non-string chunk values', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({ test: 'chunk' });
        controller.close();
      },
    });

    await debugStream(stream);

    expect(consoleLogSpy).toHaveBeenCalledWith('{"test":"chunk"}');
  });
});
