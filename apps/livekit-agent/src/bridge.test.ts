// @vitest-environment node
import type { Room } from '@livekit/rtc-node';
import {
  VOICE_CANCEL_METHOD,
  VOICE_RESULT_TOPIC,
  VOICE_TURN_METHOD,
} from '@lobechat/livekit-bridge';
import { describe, expect, it, vi } from 'vitest';

import { LobeHubBridge } from './bridge';

const setup = () => {
  const handlers = new Map<
    string,
    (reader: AsyncIterable<string>, participant: { identity: string }) => void
  >();
  const performRpc = vi.fn().mockResolvedValue('accepted');
  const room = {
    on: vi.fn(),
    localParticipant: { performRpc },
    registerTextStreamHandler: (
      topic: string,
      handler: (reader: AsyncIterable<string>, participant: { identity: string }) => void,
    ) => handlers.set(topic, handler),
  };
  const bridge = new LobeHubBridge(room as unknown as Room, 'browser');
  const respond = (requestId: string, identity = 'browser') => {
    handlers.get(VOICE_RESULT_TOPIC)!(
      (async function* () {
        yield JSON.stringify({ ok: true, requestId, text: 'Existing harness reply' });
      })(),
      { identity },
    );
  };
  return { bridge, performRpc, respond };
};

describe('LobeHubBridge', () => {
  it('delegates to the browser runtime and speaks its reply without a second LLM', async () => {
    const { bridge, performRpc, respond } = setup();
    const reader = bridge.run('Hello').getReader();
    const call = performRpc.mock.calls[0]![0];
    expect(call.method).toBe(VOICE_TURN_METHOD);
    expect(JSON.parse(call.payload).text).toBe('Hello');
    respond(JSON.parse(call.payload).requestId);
    await expect(reader.read()).resolves.toEqual({ done: false, value: 'Existing harness reply' });
    await expect(reader.read()).resolves.toMatchObject({ done: true });
    bridge.close();
  });
  it('forwards interruption only for the current request', async () => {
    const { bridge, performRpc } = setup();
    const stream = bridge.run('Work');
    const request = JSON.parse(performRpc.mock.calls[0]![0].payload);
    await stream.cancel();
    expect(performRpc).toHaveBeenCalledWith(
      expect.objectContaining({
        method: VOICE_CANCEL_METHOD,
        payload: JSON.stringify({ requestId: request.requestId }),
      }),
    );
  });
  it('does not accept a reply from a different participant', async () => {
    const { bridge, performRpc, respond } = setup();
    const reader = bridge.run('Hello').getReader();
    const id = JSON.parse(performRpc.mock.calls[0]![0].payload).requestId;
    respond(id, 'other');
    bridge.close();
    await expect(reader.read()).rejects.toThrow('Call ended');
  });
});
