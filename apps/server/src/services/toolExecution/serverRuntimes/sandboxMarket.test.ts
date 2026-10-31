import { expect, it, vi } from 'vitest';

import type { ToolExecutionContext } from '../types';
import { createSandboxMarketService } from './sandboxMarket';

const construct = vi.hoisted(() => vi.fn());
vi.mock('@/server/services/market', () => ({
  MarketService: class {
    constructor(options: unknown) {
      construct(options);
    }
  },
}));

it('requires a runtime owner before issuing an execution identity', () => {
  expect(() =>
    createSandboxMarketService({} as ToolExecutionContext, undefined, undefined, null),
  ).toThrow('userId is required');
  expect(construct).not.toHaveBeenCalled();
});
