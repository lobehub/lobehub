import { describe, expect, it, vi } from 'vitest';

import { ToolExecutionService } from '../index';

describe('ToolExecutionService truncation state propagation', () => {
  it('marks object state as truncated when low-level truncation shortens content', async () => {
    const builtinToolsExecutor = {
      execute: vi.fn().mockResolvedValue({
        content: '0123456789',
        state: { path: '/workspace/big.ts' },
        success: true,
      }),
    };
    const service = new ToolExecutionService({
      builtinToolsExecutor: builtinToolsExecutor as any,
      mcpService: {} as any,
    });

    const result = await service.executeTool(
      {
        apiName: 'readFile',
        arguments: '{"path":"/workspace/big.ts"}',
        id: 'tool-call-1',
        identifier: 'lobe-cloud-sandbox',
        type: 'builtin',
      },
      {
        toolManifestMap: {},
        toolResultMaxLength: 5,
      },
    );

    expect(result.content).toContain('[Showing lines 1-');
    expect(result.state).toEqual({ path: '/workspace/big.ts', truncated: true });
  });

  it('does not mark state as truncated when content is within the limit or truncation is skipped', async () => {
    const builtinToolsExecutor = {
      execute: vi.fn().mockResolvedValue({
        content: '0123456789',
        state: { path: '/workspace/small.ts' },
        success: true,
      }),
    };
    const service = new ToolExecutionService({
      builtinToolsExecutor: builtinToolsExecutor as any,
      mcpService: {} as any,
    });

    const skipped = await service.executeTool(
      {
        apiName: 'readFile',
        arguments: '{"path":"/workspace/small.ts"}',
        id: 'tool-call-1',
        identifier: 'lobe-cloud-sandbox',
        type: 'builtin',
      },
      {
        skipResultTruncation: true,
        toolManifestMap: {},
        toolResultMaxLength: 5,
      },
    );

    expect(skipped.state).toEqual({ path: '/workspace/small.ts' });

    const withinLimit = await service.executeTool(
      {
        apiName: 'readFile',
        arguments: '{"path":"/workspace/small.ts"}',
        id: 'tool-call-2',
        identifier: 'lobe-cloud-sandbox',
        type: 'builtin',
      },
      {
        toolManifestMap: {},
        toolResultMaxLength: 100,
      },
    );

    expect(withinLimit.state).toEqual({ path: '/workspace/small.ts' });
  });
});
