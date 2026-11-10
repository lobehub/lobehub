import { describe, expect, it, vi } from 'vitest';

import {
  REALTIME_ASR_AUDIO,
  REALTIME_ASR_LIMITS,
  type RealtimeAsrSessionResponse,
} from '@/features/ChatInput/Dictation/contract';

import { CloudRealtimeTranscriber, type CloudSocket } from './cloud';
import { createRealtimeTranscriber, resolveTranscriptionProvider } from './index';
import { LocalRealtimeTranscriber } from './local';

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isDesktop: true,
}));

const SESSION_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

const session: RealtimeAsrSessionResponse = {
  audio: REALTIME_ASR_AUDIO,
  expiresAt: new Date(Date.now() + 30_000).toISOString(),
  limits: REALTIME_ASR_LIMITS,
  protocolVersion: 1,
  sessionId: SESSION_ID,
  token: 'a.b.c',
  websocketUrl: `wss://asr.test/api/v1/realtime/ws?sessionId=${SESSION_ID}`,
};

class FakeSocket implements CloudSocket {
  binaryType: BinaryType = 'blob';
  bufferedAmount = 0;
  readyState = 0;
  sent: (ArrayBuffer | string)[] = [];
  private listeners = new Map<string, ((event: any) => void)[]>();

  addEventListener(type: string, listener: (event: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close() {
    this.readyState = 3;
  }

  emit(type: string, event?: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  open() {
    this.readyState = 1;
    this.emit('open');
  }

  server(event: Record<string, unknown>, sequence: number) {
    this.emit('message', { data: JSON.stringify({ sequence, sessionId: SESSION_ID, ...event }) });
  }

  send(data: ArrayBuffer | string) {
    this.sent.push(data);
    if (data === JSON.stringify({ type: 'session.end' })) {
      queueMicrotask(() => this.server({ forwardedAudioMs: 400, type: 'session.completed' }, 5));
    }
  }
}

describe('CloudRealtimeTranscriber', () => {
  it('speaks the v1 protocol and reports segments through the shared interface', async () => {
    const socket = new FakeSocket();
    const onFinal = vi.fn();
    const onPartial = vi.fn();
    const transcriber = new CloudRealtimeTranscriber({
      createSession: async () => session,
      createSocket: () => socket,
    });

    const started = transcriber.start({ onFinal, onPartial });
    await vi.waitFor(() => expect(socket.binaryType).toBe('arraybuffer'));
    transcriber.pushFrame(new ArrayBuffer(REALTIME_ASR_AUDIO.frameBytes));
    socket.open();
    expect(JSON.parse(socket.sent[0] as string)).toMatchObject({
      token: 'a.b.c',
      type: 'session.auth',
    });
    socket.server(
      {
        audio: REALTIME_ASR_AUDIO,
        limits: REALTIME_ASR_LIMITS,
        protocolVersion: 1,
        type: 'session.ready',
      },
      1,
    );
    await started;

    await vi.waitFor(() =>
      expect(socket.sent.some((item) => item instanceof ArrayBuffer)).toBe(true),
    );
    socket.server({ segmentId: 'seg-1', text: '大家', type: 'transcript.partial' }, 2);
    socket.server({ segmentId: 'seg-1', text: '大家好', type: 'transcript.final' }, 3);

    expect(onPartial).toHaveBeenCalledWith({ id: 'seg-1', text: '大家' });
    expect(onFinal).toHaveBeenCalledWith({ id: 'seg-1', text: '大家好' });
    await expect(transcriber.stop()).resolves.toEqual({ stats: { audioMs: 400, segments: 1 } });
  });
});

describe('createRealtimeTranscriber', () => {
  it('returns the implementation for the selected provider', () => {
    expect(createRealtimeTranscriber('local')).toBeInstanceOf(LocalRealtimeTranscriber);
    expect(createRealtimeTranscriber('cloud')).toBeInstanceOf(CloudRealtimeTranscriber);
    expect(createRealtimeTranscriber('local').provider).toBe('local');
  });
});

describe('resolveTranscriptionProvider', () => {
  const status = (provider: 'cloud' | 'local', packStatus: string, tier: string) =>
    ({
      hardware: { tier },
      packs: [{ id: 'asr-sensevoice', status: packStatus }],
      preferences: { provider },
    }) as any;

  it('keeps local only when the engine can run here', () => {
    expect(resolveTranscriptionProvider(status('local', 'ready', 'recommended'))).toBe('local');
    expect(resolveTranscriptionProvider(status('local', 'ready', 'unsupported'))).toBe('cloud');
    expect(resolveTranscriptionProvider(status('local', 'not_downloaded', 'recommended'))).toBe(
      'cloud',
    );
    expect(resolveTranscriptionProvider(status('cloud', 'ready', 'recommended'))).toBe('cloud');
  });
});
