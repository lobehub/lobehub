import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDefaultLogger, createLogger, setLoggerFactory } from '../logger';

describe('logger', () => {
  afterEach(() => {
    // Restore default factory so other tests aren't poisoned.
    setLoggerFactory(createDefaultLogger);
  });

  it('routes calls through the current factory at call time, not creation time', () => {
    // Module-level pattern: a long-lived logger is created BEFORE the host
    // (e.g. desktop) gets a chance to install its own factory. The proxy must
    // still pick up the override on subsequent method calls.
    const logger = createLogger('contentSearch:base');

    const earlyFactory = vi.fn((ns: string) => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    }));
    setLoggerFactory(earlyFactory);

    logger.warn('first');
    expect(earlyFactory).toHaveBeenCalledWith('contentSearch:base');

    // Now the desktop bootstrap fires and swaps the factory. The pre-existing
    // `logger` reference must start dispatching to the new factory.
    const desktopWarn = vi.fn();
    const desktopFactory = vi.fn(() => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: desktopWarn,
    }));
    setLoggerFactory(desktopFactory);

    logger.warn('second');
    expect(desktopFactory).toHaveBeenCalledWith('contentSearch:base');
    expect(desktopWarn).toHaveBeenCalledWith('second');
  });

  it('caches the concrete logger per namespace within one factory generation', () => {
    const factory = vi.fn((ns: string) => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    }));
    setLoggerFactory(factory);

    const logger = createLogger('contentSearch:unix');
    logger.warn('a');
    logger.warn('b');
    logger.error('c');

    // Three method calls on one namespace should only construct one underlying logger.
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
