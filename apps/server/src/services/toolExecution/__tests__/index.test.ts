// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { ToolExecutionService } from '../index';

describe('ToolExecutionService', () => {
  it('can skip low-level result truncation for AgentRuntime archival', async () => {
    const builtinToolsExecutor = {
      execute: vi.fn().mockResolvedValue({
        content: '0123456789',
        success: true,
      }),
    };
    const service = new ToolExecutionService({
      builtinToolsExecutor: builtinToolsExecutor as any,
      mcpService: {} as any,
    });

    const result = await service.executeTool(
      {
        apiName: 'search',
        arguments: '{}',
        id: 'tool-call-1',
        identifier: 'lobe-web-browsing',
        type: 'builtin',
      },
      {
        skipResultTruncation: true,
        toolManifestMap: {},
        toolResultMaxLength: 5,
      },
    );

    expect(result.content).toBe('0123456789');
  });

  it('keeps existing low-level truncation by default', async () => {
    const builtinToolsExecutor = {
      execute: vi.fn().mockResolvedValue({
        content: '0123456789',
        success: true,
      }),
    };
    const service = new ToolExecutionService({
      builtinToolsExecutor: builtinToolsExecutor as any,
      mcpService: {} as any,
    });

    const result = await service.executeTool(
      {
        apiName: 'search',
        arguments: '{}',
        id: 'tool-call-1',
        identifier: 'lobe-web-browsing',
        type: 'builtin',
      },
      {
        toolManifestMap: {},
        toolResultMaxLength: 5,
      },
    );

    expect(result.content).toContain('01234');
    expect(result.content).toContain('Content truncated');
  });
});
