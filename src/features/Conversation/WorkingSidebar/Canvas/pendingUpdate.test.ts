import { CanvasApiName, CanvasIdentifier } from '@lobechat/builtin-tool-canvas';
import { describe, expect, it } from 'vitest';

import { getCanvasUpdateStatus } from './pendingUpdate';

const updateCall = (id: string, args: string, extra: Record<string, unknown> = {}) => ({
  apiName: CanvasApiName.updateCanvas,
  arguments: args,
  id,
  identifier: CanvasIdentifier,
  type: 'builtin',
  ...extra,
});

const assistant = (...tools: any[]) => ({ content: '', id: 'msg_a', role: 'assistant', tools });

describe('getCanvasUpdateStatus', () => {
  it('is streaming while the update arguments are still arriving', () => {
    const messages = [assistant(updateCall('call_1', '{"canvasId":"cvs_1","files":[{"pa'))];

    expect(getCanvasUpdateStatus(messages as any, 'cvs_1')).toBe('streaming');
  });

  it('is executing once the call is approved and still has no result', () => {
    const messages = [
      assistant(updateCall('call_1', '{"canvasId":"cvs_1"}')),
      {
        content: '',
        id: 'msg_t',
        pluginIntervention: { status: 'approved' },
        role: 'tool',
        tool_call_id: 'call_1',
      },
    ];

    expect(getCanvasUpdateStatus(messages as any, 'cvs_1')).toBe('executing');
  });

  it('reports a call that waits for approval', () => {
    const messages = [
      assistant(updateCall('call_1', '{"canvasId":"cvs_1"}')),
      {
        content: '',
        id: 'msg_t',
        pluginIntervention: { status: 'pending' },
        role: 'tool',
        tool_call_id: 'call_1',
      },
    ];

    expect(getCanvasUpdateStatus(messages as any, 'cvs_1')).toBe('awaitingApproval');
  });

  it('settles once the tool message carries a result', () => {
    const messages = [
      assistant(updateCall('call_1', '{"canvasId":"cvs_1"}')),
      {
        content: 'Saved canvas cvs_1',
        id: 'msg_t',
        pluginState: { canvasId: 'cvs_1' },
        role: 'tool',
        tool_call_id: 'call_1',
      },
    ];

    expect(getCanvasUpdateStatus(messages as any, 'cvs_1')).toBe('none');
  });

  it('settles when the user rejects or aborts the call', () => {
    for (const status of ['rejected', 'aborted']) {
      const messages = [
        assistant(updateCall('call_1', '{"canvasId":"cvs_1"}', { intervention: { status } })),
      ];

      expect(getCanvasUpdateStatus(messages as any, 'cvs_1')).toBe('none');
    }
  });

  it('ignores updates to other canvases and other canvas calls', () => {
    const messages = [
      assistant(updateCall('call_1', '{"canvasId":"cvs_2"}'), {
        ...updateCall('call_2', '{"canvasId":"cvs_1"}'),
        apiName: CanvasApiName.readCanvas,
      }),
    ];

    expect(getCanvasUpdateStatus(messages as any, 'cvs_1')).toBe('none');
  });
});
