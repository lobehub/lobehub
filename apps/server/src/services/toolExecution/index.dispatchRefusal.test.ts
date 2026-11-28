// @vitest-environment node
import { executeToolWithRetry } from '@lobechat/agent-runtime';
import { describe, expect, it, vi } from 'vitest';

import { ToolExecutionService } from './index';

const refusal = 'Execution device changed; start a new call for the selected device';

vi.mock('@/server/services/contextReplay/toolDispatch', () => ({
  assertCurrentToolDispatch: vi.fn(async () => {
    throw new Error(refusal);
  }),
}));

describe('ToolExecutionService dispatch refusal', () => {
  it('tells the model why a call was refused instead of failing the step', async () => {
    const execute = vi.fn();
    const service = new ToolExecutionService({
      builtinToolsExecutor: { execute } as any,
      mcpService: {} as any,
    });

    const { attempts, result } = await executeToolWithRetry(
      () =>
        service.executeTool(
          {
            apiName: 'runCommand',
            arguments: '{"command":"echo ok"}',
            id: 'call_refused',
            identifier: 'lobe-local-system',
            type: 'builtin',
          },
          {
            agentId: 'agt_a',
            serverDB: {} as any,
            toolManifestMap: {},
            topicId: 'tpc_a',
            userId: 'user_a',
          },
        ),
      { maxRetries: 2 },
    );

    expect(execute).not.toHaveBeenCalled();
    expect(attempts).toBe(1);
    expect(result.success).toBe(false);
    expect(result.content).toContain(refusal);
    expect(result.error).toMatchObject({ message: refusal });
  });
});
