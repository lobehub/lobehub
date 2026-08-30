import { describe, expect, it } from 'vitest';

import { getHeterogeneousAgentDriver } from '../index';
import { cursorDriver } from './cursor';

describe('cursorDriver', () => {
  it('is registered but rejects the obsolete one-shot spawn path', async () => {
    expect(getHeterogeneousAgentDriver('cursor')).toBe(cursorDriver);
    await expect(cursorDriver.buildSpawnPlan({} as never)).rejects.toThrow('native ACP session');
  });
});
