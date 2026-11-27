import { beforeEach, describe, expect, it, vi } from 'vitest';

import { archiveRuntimeToolResult } from '../executorHelpers';

const { archiveToolResultIfNeededMock } = vi.hoisted(() => ({
  archiveToolResultIfNeededMock: vi.fn(),
}));

vi.mock('@/server/services/toolExecution/archiveToolResult', () => ({
  archiveToolResultIfNeeded: archiveToolResultIfNeededMock,
}));

describe('archiveRuntimeToolResult', () => {
  beforeEach(() => {
    archiveToolResultIfNeededMock.mockReset();
  });

  it('marks object state as truncated when content is shortened by archival', async () => {
    archiveToolResultIfNeededMock.mockResolvedValue({
      archived: true,
      content: 'head\n[Showing lines 1-10 of 100 lines, 50000 characters.]',
    });

    const result = await archiveRuntimeToolResult(
      {
        content: 'x'.repeat(50_000),
        executionTime: 10,
        state: { path: '/workspace/big.ts' },
        success: true,
      },
      {
        identifier: 'lobe-cloud-sandbox',
        serverDB: {} as any,
      },
    );

    expect(result.content).toContain('[Showing lines 1-10');
    expect(result.state).toEqual({ path: '/workspace/big.ts', truncated: true });
  });

  it('leaves state untouched when content is not modified', async () => {
    const originalState = { path: '/workspace/small.ts' };
    archiveToolResultIfNeededMock.mockResolvedValue({
      archived: false,
      content: 'small content',
    });

    const input = {
      content: 'small content',
      executionTime: 5,
      state: originalState,
      success: true,
    };

    const result = await archiveRuntimeToolResult(input, {
      identifier: 'lobe-cloud-sandbox',
      serverDB: {} as any,
    });

    expect(result).toBe(input);
    expect(result.state).toBe(originalState);
  });

  it('leaves missing or non-object state untouched when content is shortened', async () => {
    archiveToolResultIfNeededMock.mockResolvedValue({
      archived: false,
      content: 'shortened',
    });

    const withoutState = await archiveRuntimeToolResult(
      {
        content: 'original',
        executionTime: 5,
        success: true,
      },
      {
        serverDB: {} as any,
      },
    );

    expect(withoutState.content).toBe('shortened');
    expect(withoutState.state).toBeUndefined();
  });
});
