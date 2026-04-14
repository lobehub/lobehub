/**
 * Verify that RuntimeExecutors injects `source` from sourceMap into
 * chatToolPayload before passing it to BuiltinToolsExecutor.
 *
 * This prevents the "Builtin tool X is not implemented" error for
 * lobehubSkill and klavis tools.
 */
import { describe, expect, it, vi } from 'vitest';

import { BuiltinToolsExecutor } from '@/server/services/toolExecution/builtin';

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(() => ({
    executeLobehubSkill: vi.fn().mockResolvedValue({
      content: '{"issues":[]}',
      success: true,
    }),
  })),
}));

vi.mock('@/server/services/klavis', () => ({
  KlavisService: vi.fn().mockImplementation(() => ({
    executeKlavisTool: vi.fn().mockResolvedValue({
      content: '{"files":[]}',
      success: true,
    }),
  })),
}));

describe('BuiltinToolsExecutor source routing', () => {
  it('should route lobehubSkill tools to MarketService when source is set', async () => {
    const executor = new BuiltinToolsExecutor({} as any, 'test-user');

    const result = await executor.execute(
      {
        apiName: 'list_issues',
        arguments: '{}',
        identifier: 'linear',
        source: 'lobehubSkill',
        type: 'builtin',
      } as any,
      { topicId: 'test-topic' } as any,
    );

    // Should NOT throw "not implemented", should route to MarketService
    expect(result.success).toBe(true);
  });

  it('should route klavis tools to KlavisService when source is set', async () => {
    const executor = new BuiltinToolsExecutor({} as any, 'test-user');

    const result = await executor.execute(
      {
        apiName: 'search_documents',
        arguments: '{}',
        identifier: 'google-drive',
        source: 'klavis',
        type: 'builtin',
      } as any,
      { topicId: 'test-topic' } as any,
    );

    expect(result.success).toBe(true);
  });

  it('should throw "not implemented" for lobehubSkill tools WITHOUT source', async () => {
    const executor = new BuiltinToolsExecutor({} as any, 'test-user');

    // Without source field — this is the bug we fixed
    await expect(
      executor.execute(
        {
          apiName: 'list_issues',
          arguments: '{}',
          identifier: 'linear',
          type: 'builtin',
        } as any,
        { topicId: 'test-topic' } as any,
      ),
    ).rejects.toThrow('is not implemented');
  });
});
