import { describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import HeterogeneousAgentCtr from '../HeterogeneousAgentCtr';

const implementationMocks = vi.hoisted(() => ({
  afterAppReady: vi.fn(),
  constructor: vi.fn(),
  startSession: vi.fn(async (..._args: unknown[]) => ({ sessionId: 'session-1' })),
}));

vi.mock('../HeterogeneousAgentImpl', () => ({
  default: class MockHeterogeneousAgentImplementation {
    constructor(app: App) {
      implementationMocks.constructor(app);
    }

    afterAppReady() {
      implementationMocks.afterAppReady();
    }

    startSession(...args: unknown[]) {
      return implementationMocks.startSession(...args);
    }
  },
}));

describe('HeterogeneousAgentCtr lazy implementation', () => {
  it('defers the heavy implementation and initializes it exactly once on first use', async () => {
    const app = {} as App;
    const controller = new HeterogeneousAgentCtr(app);

    expect(implementationMocks.constructor).not.toHaveBeenCalled();
    expect(implementationMocks.afterAppReady).not.toHaveBeenCalled();

    await expect((controller as any).startSession({ prompt: 'first' })).resolves.toEqual({
      sessionId: 'session-1',
    });
    await (controller as any).startSession({ prompt: 'second' });

    expect(implementationMocks.constructor).toHaveBeenCalledOnce();
    expect(implementationMocks.constructor).toHaveBeenCalledWith(app);
    expect(implementationMocks.afterAppReady).toHaveBeenCalledOnce();
    expect(implementationMocks.startSession).toHaveBeenCalledTimes(2);
  });
});
