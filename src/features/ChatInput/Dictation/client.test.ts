import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RealtimeAudioCapture } from './audio';
import { type RealtimeAsrWebSocket, RealtimeDictationClient } from './client';
import {
  REALTIME_ASR_AUDIO,
  REALTIME_ASR_LIMITS,
  type RealtimeAsrServerEvent,
  type RealtimeAsrSessionResponse,
} from './contract';
import type { DictationEditorAdapter } from './editor';

class FakeSocket {
  binaryType: BinaryType = 'blob';
  bufferedAmount = 0;
  readyState = 0;
  sent: Array<ArrayBuffer | string> = [];
  readonly listeners = new Map<string, Set<(event?: MessageEvent) => void>>();

  addEventListener(type: string, listener: (event?: MessageEvent) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event?: MessageEvent) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: ArrayBuffer | string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
  }

  open() {
    this.readyState = 1;
    this.emit('open');
  }

  serverEvent(event: RealtimeAsrServerEvent) {
    this.emit('message', { data: JSON.stringify(event) } as MessageEvent);
  }

  disconnect() {
    this.readyState = 3;
    this.emit('close');
  }

  private emit(type: string, event?: MessageEvent) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const session = (): RealtimeAsrSessionResponse => ({
  audio: REALTIME_ASR_AUDIO,
  expiresAt: new Date(Date.now() + 30_000).toISOString(),
  limits: REALTIME_ASR_LIMITS,
  protocolVersion: 1,
  sessionId: 'session-1',
  token: 'a'.repeat(43),
  websocketUrl: 'wss://asr.example.test/v1/session',
});

const ready = (sequence = 1): RealtimeAsrServerEvent => ({
  audio: REALTIME_ASR_AUDIO,
  limits: REALTIME_ASR_LIMITS,
  protocolVersion: 1,
  sequence,
  sessionId: 'session-1',
  type: 'session.ready',
});

const createFixture = () => {
  const socket = new FakeSocket();
  let onFrame: ((frame: ArrayBuffer) => void) | undefined;
  const capture: RealtimeAudioCapture = {
    cancel: vi.fn().mockResolvedValue(undefined),
    start: vi.fn(async (frameHandler: (frame: ArrayBuffer) => void) => {
      onFrame = frameHandler;
    }),
    stop: vi.fn().mockResolvedValue(undefined),
  };
  let onUserEdit: (() => void) | undefined;
  const editor: DictationEditorAdapter = {
    begin: vi.fn((callback) => {
      onUserEdit = callback;
      return { anchor: 6, prefix: 'draft ', suffix: ' tail' };
    }),
    dispose: vi.fn(),
    finalize: vi.fn(),
    render: vi.fn(),
  };
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const client = new RealtimeDictationClient({
    createCapture: vi.fn().mockResolvedValue(capture),
    createSession: vi.fn().mockResolvedValue(session()),
    createWebSocket: vi.fn(() => socket as unknown as RealtimeAsrWebSocket),
    editor,
    requestMicrophone: vi.fn().mockResolvedValue(stream),
  });

  const start = async () => {
    await client.start();
    expect(client.getSnapshot().status).toBe('connecting');
    socket.open();
    socket.serverEvent(ready());
    await vi.waitFor(() => expect(client.getSnapshot().status).toBe('listening'));
  };

  return {
    capture,
    client,
    editor,
    emitFrame: (frame: ArrayBuffer) => onFrame?.(frame),
    onUserEdit: () => onUserEdit?.(),
    socket,
    start,
    track,
  };
};

describe('RealtimeDictationClient', () => {
  afterEach(() => vi.useRealTimers());

  it('authenticates, applies partial/final events, and waits for completion on stop', async () => {
    const fixture = createFixture();
    await fixture.start();

    expect(JSON.parse(fixture.socket.sent[0] as string)).toEqual({
      protocolVersion: 1,
      token: 'a'.repeat(43),
      type: 'session.auth',
    });
    fixture.socket.serverEvent({
      segmentId: 'segment-1',
      sequence: 2,
      sessionId: 'session-1',
      text: 'hel',
      type: 'transcript.partial',
    });
    fixture.socket.serverEvent({
      segmentId: 'segment-1',
      sequence: 3,
      sessionId: 'session-1',
      text: 'hello',
      type: 'transcript.final',
    });
    expect(fixture.editor.render).toHaveBeenNthCalledWith(1, 'hel');
    expect(fixture.editor.render).toHaveBeenNthCalledWith(2, 'hello');

    await fixture.client.stop();
    expect(fixture.client.getSnapshot().status).toBe('finalizing');
    expect(JSON.parse(fixture.socket.sent.at(-1) as string)).toEqual({ type: 'session.end' });
    fixture.socket.serverEvent({
      forwardedAudioMs: 200,
      sequence: 4,
      sessionId: 'session-1',
      type: 'session.completed',
    });
    await vi.waitFor(() => expect(fixture.client.getSnapshot().status).toBe('idle'));
    expect(fixture.editor.finalize).toHaveBeenCalledOnce();
    expect(fixture.editor.finalize).toHaveBeenCalledWith('hello');
  });

  it('keeps final text and drops only partial text on cancel', async () => {
    const fixture = createFixture();
    await fixture.start();
    fixture.socket.serverEvent({
      segmentId: 'segment-1',
      sequence: 2,
      sessionId: 'session-1',
      text: 'confirmed',
      type: 'transcript.final',
    });
    fixture.socket.serverEvent({
      segmentId: 'segment-2',
      sequence: 3,
      sessionId: 'session-1',
      text: 'temporary',
      type: 'transcript.partial',
    });

    await fixture.client.cancel();

    expect(fixture.editor.finalize).toHaveBeenCalledWith('confirmed');
    expect(JSON.parse(fixture.socket.sent.at(-1) as string)).toEqual({
      reason: 'user_cancelled',
      type: 'session.cancel',
    });
    fixture.socket.serverEvent({
      forwardedAudioMs: 400,
      sequence: 4,
      sessionId: 'session-1',
      type: 'session.cancelled',
    });
    await vi.waitFor(() => expect(fixture.client.getSnapshot().status).toBe('idle'));
  });

  it('ignores old-session, duplicate, and out-of-order transcripts', async () => {
    const fixture = createFixture();
    await fixture.start();
    fixture.socket.serverEvent({
      segmentId: 'segment-1',
      sequence: 2,
      sessionId: 'old-session',
      text: 'old',
      type: 'transcript.partial',
    });
    fixture.socket.serverEvent({
      segmentId: 'segment-1',
      sequence: 3,
      sessionId: 'session-1',
      text: 'new',
      type: 'transcript.partial',
    });
    fixture.socket.serverEvent({
      segmentId: 'segment-1',
      sequence: 3,
      sessionId: 'session-1',
      text: 'duplicate',
      type: 'transcript.partial',
    });
    fixture.socket.serverEvent({
      segmentId: 'segment-1',
      sequence: 2,
      sessionId: 'session-1',
      text: 'out-of-order',
      type: 'transcript.final',
    });

    expect(fixture.editor.render).toHaveBeenCalledOnce();
    expect(fixture.editor.render).toHaveBeenCalledWith('new');
  });

  it('ends safely on user edit and preserves confirmed text', async () => {
    const fixture = createFixture();
    await fixture.start();
    fixture.socket.serverEvent({
      segmentId: 'segment-1',
      sequence: 2,
      sessionId: 'session-1',
      text: 'confirmed',
      type: 'transcript.final',
    });

    fixture.onUserEdit();
    await vi.waitFor(() => expect(fixture.client.getSnapshot().status).toBe('finalizing'));
    await vi.waitFor(() => expect(fixture.socket.sent).toHaveLength(2));

    expect(fixture.editor.finalize).toHaveBeenCalledWith('confirmed');
    expect(JSON.parse(fixture.socket.sent.at(-1) as string)).toEqual({
      reason: 'audio_interruption',
      type: 'session.cancel',
    });
  });

  it('keeps confirmed text and reports a network disconnect', async () => {
    const fixture = createFixture();
    await fixture.start();
    fixture.socket.serverEvent({
      segmentId: 'segment-1',
      sequence: 2,
      sessionId: 'session-1',
      text: 'confirmed',
      type: 'transcript.final',
    });
    fixture.socket.disconnect();

    await vi.waitFor(() => expect(fixture.client.getSnapshot().status).toBe('error'));
    expect(fixture.client.getSnapshot()).toMatchObject({
      errorCode: 'NETWORK_DISCONNECTED',
      retryable: true,
    });
    expect(fixture.editor.finalize).toHaveBeenCalledWith('confirmed');
  });

  it('surfaces stable gateway error events without keeping partial text', async () => {
    const fixture = createFixture();
    await fixture.start();
    fixture.socket.serverEvent({
      segmentId: 'segment-1',
      sequence: 2,
      sessionId: 'session-1',
      text: 'temporary',
      type: 'transcript.partial',
    });
    fixture.socket.serverEvent({
      code: 'PROVIDER_CAPACITY',
      retryable: true,
      sequence: 3,
      sessionId: 'session-1',
      type: 'session.error',
    });

    await vi.waitFor(() => expect(fixture.client.getSnapshot().status).toBe('error'));
    expect(fixture.client.getSnapshot()).toMatchObject({
      errorCode: 'PROVIDER_CAPACITY',
      retryable: true,
    });
    expect(fixture.editor.finalize).toHaveBeenCalledWith('');
  });

  it('fails deterministically when final completion exceeds the server timeout', async () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    await fixture.start();
    await fixture.client.stop();

    await vi.advanceTimersByTimeAsync(REALTIME_ASR_LIMITS.finalTimeoutMs);

    expect(fixture.client.getSnapshot()).toMatchObject({
      errorCode: 'FINAL_TIMEOUT',
      retryable: true,
      status: 'error',
    });
  });

  it('fails instead of growing the send queue without bound', async () => {
    const fixture = createFixture();
    await fixture.start();
    fixture.socket.bufferedAmount = 64_000;

    for (let index = 0; index < 6; index += 1) fixture.emitFrame(new ArrayBuffer(6400));

    await vi.waitFor(() => expect(fixture.client.getSnapshot().status).toBe('error'));
    expect(fixture.client.getSnapshot().errorCode).toBe('BACKPRESSURE');
  });
});
