import { CanvasApiName } from '@lobechat/builtin-tool-canvas';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { takeWorkIntent } from '@/utils/clientWorkIntentStash';

const { runAgentTool } = vi.hoisted(() => ({ runAgentTool: vi.fn() }));

vi.mock('@/services/canvas', () => ({ canvasService: { runAgentTool } }));

const intent = {
  action: 'register' as const,
  canvas: {
    canvasId: 'cvs_1',
    description: null,
    metadata: {
      entry: 'index.html',
      fileCount: 1,
      manifestKey: 'canvas/u/cvs_1/manifests/a.json',
      runtimeMajor: 1,
      totalSize: 10,
    },
    title: 'Cost',
    toolName: 'createCanvas',
  },
  type: 'canvas' as const,
};

beforeEach(() => {
  runAgentTool.mockReset();
});

describe('canvasExecutor', () => {
  it('exposes every Canvas API', async () => {
    const { canvasExecutor } = await import('./lobe-canvas');

    for (const api of Object.values(CanvasApiName)) expect(canvasExecutor.hasApi(api)).toBe(true);
  });

  it('runs the call server-side and stashes the Work intent for call_tool', async () => {
    const { canvasExecutor } = await import('./lobe-canvas');
    runAgentTool.mockResolvedValue({
      intent,
      output: { content: 'Saved canvas cvs_1', state: { canvasId: 'cvs_1' }, success: true },
    });

    const result = await canvasExecutor.invoke(
      CanvasApiName.createCanvas,
      { files: [], title: 'Cost' },
      {
        agentId: 'agt_1',
        messageId: 'msg_1',
        threadId: 'thd_1',
        toolCallId: 'call_1',
        topicId: 'tpc_1',
      } as any,
    );

    expect(runAgentTool).toHaveBeenCalledWith(
      CanvasApiName.createCanvas,
      { files: [], title: 'Cost' },
      { agentId: 'agt_1', messageId: 'msg_1', threadId: 'thd_1', topicId: 'tpc_1' },
    );
    expect(result).toEqual({
      content: 'Saved canvas cvs_1',
      state: { canvasId: 'cvs_1' },
      success: true,
    });
    expect(takeWorkIntent('call_1')).toEqual(intent);
  });

  it('turns a refused save into a failed result without a Work intent', async () => {
    const { canvasExecutor } = await import('./lobe-canvas');
    runAgentTool.mockResolvedValue({
      output: { content: 'The canvas was not saved.', state: { issues: [] }, success: false },
    });

    const result = await canvasExecutor.invoke(CanvasApiName.updateCanvas, { canvasId: 'cvs_1' }, {
      toolCallId: 'call_2',
      topicId: 'tpc_1',
    } as any);

    expect(result).toMatchObject({ content: 'The canvas was not saved.', success: false });
    expect(takeWorkIntent('call_2')).toBeUndefined();
  });
});
