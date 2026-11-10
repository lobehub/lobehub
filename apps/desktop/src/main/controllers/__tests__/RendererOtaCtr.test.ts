import { beforeEach, describe, expect, it, vi } from 'vitest';

import RendererOtaCtr from '../RendererOtaCtr';

const { markHealthy } = vi.hoisted(() => ({ markHealthy: vi.fn() }));

vi.mock('@/const/shell', () => ({ shellInfo: { markHealthy } }));

const makeCtr = () => {
  const handleBootPing = vi.fn();
  const ctr = new RendererOtaCtr({ coreUpdateManager: { handleBootPing } } as never);
  return { ctr, handleBootPing };
};

beforeEach(() => {
  markHealthy.mockClear();
});

describe('RendererOtaCtr.bootPing', () => {
  it('forwards every ping and marks the core healthy once on mount', async () => {
    const { ctr, handleBootPing } = makeCtr();
    await ctr.bootPing('loaded');
    expect(markHealthy).not.toHaveBeenCalled();
    await ctr.bootPing('mounted');
    await ctr.bootPing('mounted');
    await ctr.bootPing();
    expect(handleBootPing).toHaveBeenCalledTimes(4);
    expect(markHealthy).toHaveBeenCalledTimes(1);
  });
});
