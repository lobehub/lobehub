import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RealtimeAudioCapture } from './audio';
import type { RealtimeAsrWebSocket, RealtimeDictationTiming } from './client';
import { REALTIME_DICTATION_PERFORMANCE_MARKS, RealtimeDictationClient } from './client';
import {
  REALTIME_ASR_AUDIO,
  REALTIME_ASR_DEFERRED_LIMITS,
  REALTIME_ASR_LIMITS,
  type RealtimeAsrServerEvent,
  type RealtimeAsrSessionResponse,
  RealtimeDictationError,
} from './contract';
import type { DictationEditorAdapter } from './editor';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const OLD_SESSION_ID = '00000000-0000-4000-8000-000000000002';
const FRESH_SESSION_ID = '00000000-0000-4000-8000-000000000003';
const TEST_JWT = [
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJzdWIiOiJ1c2VyLTEifQ',
  'c2lnbmF0dXJl',
].join('.');

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

  close = vi.fn(() => {
    this.readyState = 3;
  });

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

const session = (
  overrides: Partial<RealtimeAsrSessionResponse> = {},
): RealtimeAsrSessionResponse => {
  const sessionId = overrides.sessionId ?? SESSION_ID;
  return {
    audio: REALTIME_ASR_AUDIO,
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
    limits: REALTIME_ASR_LIMITS,
    protocolVersion: 1,
    sessionId,
    token: TEST_JWT,
    websocketUrl: `wss://asr.example.test/api/v1/realtime/ws?sessionId=${sessionId}`,
    ...overrides,
  };
};

const ready = (sequence = 1): RealtimeAsrServerEvent => ({
  audio: REALTIME_ASR_AUDIO,
  limits: REALTIME_ASR_LIMITS,
  protocolVersion: 1,
  sequence,
  sessionId: SESSION_ID,
  type: 'session.ready',
});

const accepted = (sequence = 1, sessionId = SESSION_ID): RealtimeAsrServerEvent => ({
  audio: REALTIME_ASR_AUDIO,
  deferredLimits: REALTIME_ASR_DEFERRED_LIMITS,
  limits: REALTIME_ASR_LIMITS,
  protocolVersion: 1,
  sequence,
  sessionId,
  type: 'session.accepted',
});

const sentControls = (socket: FakeSocket) =>
  socket.sent
    .filter((data): data is string => typeof data === 'string')
    .map((data) => JSON.parse(data) as Record<string, unknown>);

const createFixture = (microphone?: () => Promise<MediaStream>) => {
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
  const createSession = vi.fn().mockResolvedValue(session());
  const createWebSocket = vi.fn(() => socket as unknown as RealtimeAsrWebSocket);
  const client = new RealtimeDictationClient({
    createCapture: vi.fn().mockResolvedValue(capture),
    createSession,
    createWebSocket,
    editor,
    requestMicrophone: microphone ?? vi.fn().mockResolvedValue(stream),
  });

  const handshake = async (event: RealtimeAsrServerEvent = accepted()) => {
    await vi.waitFor(() => expect(createWebSocket).toHaveBeenCalled());
    socket.open();
    socket.serverEvent(event);
  };

  const start = async (event: RealtimeAsrServerEvent = accepted()) => {
    const starting = client.start();
    await handshake(event);
    await starting;
    expect(client.getSnapshot().status).toBe('listening');
  };

  return {
    capture,
    client,
    createSession,
    createWebSocket,
    editor,
    handshake,
    emitFrame: (frame: ArrayBuffer) => onFrame?.(frame),
    onUserEdit: () => onUserEdit?.(),
    socket,
    start,
    stream,
    track,
  };
};

describe('RealtimeDictationClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('connects during the permission prompt and starts the Provider before capture setup ends', async () => {
    let resolvePermission!: (stream: MediaStream) => void;
    let resolveCapture!: (capture: RealtimeAudioCapture) => void;
    const socket = new FakeSocket();
    const capture: RealtimeAudioCapture = {
      cancel: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const createWebSocket = vi.fn(() => socket as unknown as RealtimeAsrWebSocket);
    const client = new RealtimeDictationClient({
      createCapture: vi.fn(
        () =>
          new Promise<RealtimeAudioCapture>((resolve) => {
            resolveCapture = resolve;
          }),
      ),
      createSession: vi.fn().mockResolvedValue(session()),
      createWebSocket,
      editor: {
        begin: vi.fn(() => ({ anchor: 0, prefix: '', suffix: '' })),
        dispose: vi.fn(),
        finalize: vi.fn(),
        render: vi.fn(),
      },
      requestMicrophone: vi.fn(
        () =>
          new Promise<MediaStream>((resolve) => {
            resolvePermission = resolve;
          }),
      ),
    });

    const starting = client.start();
    await vi.waitFor(() => expect(createWebSocket).toHaveBeenCalledOnce());
    socket.open();
    expect(sentControls(socket)).toEqual([
      { protocolVersion: 1, start: 'deferred', token: TEST_JWT, type: 'session.auth' },
    ]);
    socket.serverEvent(accepted());
    await Promise.resolve();
    expect(client.getSnapshot().status).toBe('requesting_permission');
    expect(sentControls(socket)).toHaveLength(1);

    resolvePermission({ getTracks: () => [] } as unknown as MediaStream);
    await vi.waitFor(() => expect(sentControls(socket).at(-1)).toEqual({ type: 'session.start' }));
    expect(capture.start).not.toHaveBeenCalled();

    resolveCapture(capture);
    await starting;
    expect(capture.start).toHaveBeenCalledOnce();
    expect(client.getSnapshot().status).toBe('listening');
  });

  it('aborts Admission and stops a late microphone stream when cancelled during permission', async () => {
    let admissionSignal!: AbortSignal;
    let resolvePermission!: (stream: MediaStream) => void;
    let resolveSession!: (session: RealtimeAsrSessionResponse) => void;
    const track = { stop: vi.fn() };
    const createCapture = vi.fn();
    const createSession = vi.fn((signal: AbortSignal) => {
      admissionSignal = signal;
      return new Promise<RealtimeAsrSessionResponse>((resolve) => {
        resolveSession = resolve;
      });
    });
    const createWebSocket = vi.fn(() => new FakeSocket() as unknown as RealtimeAsrWebSocket);
    const client = new RealtimeDictationClient({
      createCapture,
      createSession,
      createWebSocket,
      editor: {
        begin: vi.fn(() => ({ anchor: 0, prefix: '', suffix: '' })),
        dispose: vi.fn(),
        finalize: vi.fn(),
        render: vi.fn(),
      },
      requestMicrophone: vi.fn(
        () =>
          new Promise<MediaStream>((resolve) => {
            resolvePermission = resolve;
          }),
      ),
    });

    const startPromise = client.start();
    await vi.waitFor(() => expect(createSession).toHaveBeenCalledOnce());

    await client.cancel();
    expect(admissionSignal.aborted).toBe(true);
    expect(client.getSnapshot().status).toBe('idle');

    resolveSession(session());
    resolvePermission({ getTracks: () => [track] } as unknown as MediaStream);
    await startPromise;

    expect(track.stop).toHaveBeenCalledOnce();
    expect(createCapture).not.toHaveBeenCalled();
    expect(createWebSocket).not.toHaveBeenCalled();
  });

  it('handles a late Admission after permission is denied without opening the WS', async () => {
    let resolveSession!: (session: RealtimeAsrSessionResponse) => void;
    const sessionPromise = new Promise<RealtimeAsrSessionResponse>((resolve) => {
      resolveSession = resolve;
    });
    const createSession = vi.fn(() => sessionPromise);
    const createWebSocket = vi.fn(() => new FakeSocket() as unknown as RealtimeAsrWebSocket);
    const client = new RealtimeDictationClient({
      createCapture: vi.fn(),
      createSession,
      createWebSocket,
      editor: {
        begin: vi.fn(() => ({ anchor: 0, prefix: '', suffix: '' })),
        dispose: vi.fn(),
        finalize: vi.fn(),
        render: vi.fn(),
      },
      requestMicrophone: vi
        .fn()
        .mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError')),
    });

    await client.start();

    expect(createSession).toHaveBeenCalledOnce();
    expect(client.getSnapshot()).toMatchObject({
      errorCode: 'MICROPHONE_PERMISSION_DENIED',
      retryable: true,
      status: 'error',
    });
    expect(createWebSocket).not.toHaveBeenCalled();

    resolveSession(session());
    await Promise.resolve();
    expect(createWebSocket).not.toHaveBeenCalled();
  });

  it('releases a late audio capture when concurrent session admission fails', async () => {
    let resolveCapture!: (capture: RealtimeAudioCapture) => void;
    const capture: RealtimeAudioCapture = {
      cancel: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const client = new RealtimeDictationClient({
      createCapture: vi.fn(
        () =>
          new Promise<RealtimeAudioCapture>((resolve) => {
            resolveCapture = resolve;
          }),
      ),
      createSession: vi
        .fn()
        .mockRejectedValue(new RealtimeDictationError('SESSION_CREATE_FAILED', true)),
      createWebSocket: vi.fn(() => new FakeSocket() as unknown as RealtimeAsrWebSocket),
      editor: {
        begin: vi.fn(() => ({ anchor: 0, prefix: '', suffix: '' })),
        dispose: vi.fn(),
        finalize: vi.fn(),
        render: vi.fn(),
      },
      requestMicrophone: vi
        .fn()
        .mockResolvedValue({ getTracks: () => [] } as unknown as MediaStream),
    });

    await client.start();
    expect(client.getSnapshot()).toMatchObject({
      errorCode: 'SESSION_CREATE_FAILED',
      status: 'error',
    });

    resolveCapture(capture);
    await vi.waitFor(() => expect(capture.cancel).toHaveBeenCalledOnce());
  });

  it('authenticates, applies partial/final events, and waits for completion on stop', async () => {
    const fixture = createFixture();
    await fixture.start();

    expect(sentControls(fixture.socket).slice(0, 2)).toEqual([
      { protocolVersion: 1, start: 'deferred', token: TEST_JWT, type: 'session.auth' },
      { type: 'session.start' },
    ]);
    fixture.socket.serverEvent({
      segmentId: 'segment-1',
      sequence: 2,
      sessionId: SESSION_ID,
      text: 'hel',
      type: 'transcript.partial',
    });
    fixture.socket.serverEvent({
      segmentId: 'segment-1',
      sequence: 3,
      sessionId: SESSION_ID,
      text: 'hello',
      type: 'transcript.final',
    });
    expect(fixture.editor.render).toHaveBeenNthCalledWith(1, 'hel');
    expect(fixture.editor.render).toHaveBeenNthCalledWith(2, 'hello');

    await fixture.client.stop();
    expect(fixture.client.getSnapshot().status).toBe('finalizing');
    expect(sentControls(fixture.socket).at(-1)).toEqual({
      clientTimings: {
        pressToFirstPartialMs: expect.any(Number),
        pressToMicMs: expect.any(Number),
        pressToStartSentMs: expect.any(Number),
      },
      type: 'session.end',
    });
    fixture.socket.serverEvent({
      forwardedAudioMs: 200,
      sequence: 4,
      sessionId: SESSION_ID,
      type: 'session.completed',
    });
    await vi.waitFor(() => expect(fixture.client.getSnapshot().status).toBe('idle'));
    expect(fixture.editor.finalize).toHaveBeenCalledOnce();
    expect(fixture.editor.finalize).toHaveBeenCalledWith('hello');
  });

  it('refreshes an Admission that arrives too close to expiry before opening the WS', async () => {
    let timingNow = 0;
    const timings: RealtimeDictationTiming[] = [];
    const socket = new FakeSocket();
    const firstSession = session({
      expiresAt: new Date(130_000).toISOString(),
      sessionId: OLD_SESSION_ID,
      token: 'old.header.signature',
    });
    const freshSession = session({
      expiresAt: new Date(160_000).toISOString(),
      sessionId: FRESH_SESSION_ID,
      token: 'fresh.header.signature',
    });
    const createSession = vi
      .fn()
      .mockImplementationOnce(async () => {
        timingNow = 10;
        return firstSession;
      })
      .mockImplementationOnce(async () => {
        timingNow = 40;
        return freshSession;
      });
    const createWebSocket = vi.fn(() => socket as unknown as RealtimeAsrWebSocket);
    const client = new RealtimeDictationClient({
      createCapture: vi.fn().mockResolvedValue({
        cancel: vi.fn().mockResolvedValue(undefined),
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
      }),
      createSession,
      createWebSocket,
      editor: {
        begin: vi.fn(() => ({ anchor: 0, prefix: '', suffix: '' })),
        dispose: vi.fn(),
        finalize: vi.fn(),
        render: vi.fn(),
      },
      now: () => timingNow,
      onTiming: (timing) => timings.push(timing),
      requestMicrophone: vi.fn().mockResolvedValue({ getTracks: () => [] }),
      wallClockNow: () => 129_500,
    });

    void client.start();
    await vi.waitFor(() => expect(createWebSocket).toHaveBeenCalledOnce());

    expect(createSession).toHaveBeenCalledTimes(2);
    expect(createWebSocket).toHaveBeenCalledWith(freshSession.websocketUrl);
    expect(timings.filter(({ stage }) => stage.startsWith('admission'))).toEqual([
      { durationMs: 10, stage: 'admission' },
      { durationMs: 40, stage: 'admission_refresh' },
    ]);
    socket.open();
    expect(JSON.parse(socket.sent[0] as string)).toMatchObject({ token: freshSession.token });
  });

  it('fails without opening the WS when the single refreshed Admission is still expiring', async () => {
    const capture: RealtimeAudioCapture = {
      cancel: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const staleSession = session({ expiresAt: new Date(100_500).toISOString() });
    const createSession = vi.fn().mockResolvedValue(staleSession);
    const createWebSocket = vi.fn(() => new FakeSocket() as unknown as RealtimeAsrWebSocket);
    const client = new RealtimeDictationClient({
      createCapture: vi.fn().mockResolvedValue(capture),
      createSession,
      createWebSocket,
      editor: {
        begin: vi.fn(() => ({ anchor: 0, prefix: '', suffix: '' })),
        dispose: vi.fn(),
        finalize: vi.fn(),
        render: vi.fn(),
      },
      requestMicrophone: vi
        .fn()
        .mockResolvedValue({ getTracks: () => [] } as unknown as MediaStream),
      wallClockNow: () => 100_000,
    });

    await client.start();

    expect(createSession).toHaveBeenCalledTimes(2);
    expect(createWebSocket).not.toHaveBeenCalled();
    expect(capture.cancel).toHaveBeenCalledOnce();
    expect(client.getSnapshot()).toEqual({
      errorCode: 'SESSION_EXPIRED',
      retryable: true,
      status: 'error',
    });
  });

  it('reports content-free stage timings relative to start and emits fixed performance marks', async () => {
    let clock = 100;
    let resolveCapture!: (capture: RealtimeAudioCapture) => void;
    let resolvePermission!: (stream: MediaStream) => void;
    let resolveSession!: (session: RealtimeAsrSessionResponse) => void;
    const timings: RealtimeDictationTiming[] = [];
    const socket = new FakeSocket();
    const capture: RealtimeAudioCapture = {
      cancel: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const markSpy = vi.spyOn(performance, 'mark');
    const client = new RealtimeDictationClient({
      createCapture: vi.fn(
        () =>
          new Promise<RealtimeAudioCapture>((resolve) => {
            resolveCapture = resolve;
          }),
      ),
      createSession: vi.fn(
        () =>
          new Promise<RealtimeAsrSessionResponse>((resolve) => {
            resolveSession = resolve;
          }),
      ),
      createWebSocket: vi.fn(() => socket as unknown as RealtimeAsrWebSocket),
      editor: {
        begin: vi.fn(() => ({ anchor: 0, prefix: '', suffix: '' })),
        dispose: vi.fn(),
        finalize: vi.fn(),
        render: vi.fn(),
      },
      now: () => clock,
      onTiming: (timing) => timings.push(timing),
      requestMicrophone: vi.fn(
        () =>
          new Promise<MediaStream>((resolve) => {
            resolvePermission = resolve;
          }),
      ),
    });

    const startPromise = client.start();
    await vi.waitFor(() => expect(resolveSession).toBeTypeOf('function'));

    clock = 120;
    resolveSession(session());
    await vi.waitFor(() => expect(timings).toEqual([{ durationMs: 20, stage: 'admission' }]));

    clock = 140;
    resolvePermission({ getTracks: () => [] } as unknown as MediaStream);
    await vi.waitFor(() =>
      expect(timings).toEqual([
        { durationMs: 20, stage: 'admission' },
        { durationMs: 40, stage: 'permission' },
      ]),
    );

    clock = 160;
    resolveCapture(capture);
    await vi.waitFor(() => expect(timings.at(-1)).toEqual({ durationMs: 60, stage: 'capture' }));

    socket.open();
    clock = 200;
    socket.serverEvent(accepted());
    await startPromise;
    expect(client.getSnapshot().status).toBe('listening');

    expect(timings).toEqual([
      { durationMs: 20, stage: 'admission' },
      { durationMs: 40, stage: 'permission' },
      { durationMs: 60, stage: 'capture' },
      { durationMs: 100, stage: 'ws_ready' },
    ]);
    expect(markSpy.mock.calls.map(([mark]) => mark)).toEqual([
      REALTIME_DICTATION_PERFORMANCE_MARKS.start,
      REALTIME_DICTATION_PERFORMANCE_MARKS.admission,
      REALTIME_DICTATION_PERFORMANCE_MARKS.permission,
      REALTIME_DICTATION_PERFORMANCE_MARKS.capture,
      REALTIME_DICTATION_PERFORMANCE_MARKS.ws_ready,
    ]);
  });

  it('closes an open pre-accepted socket without sending cancel or waiting for a terminal event', async () => {
    const fixture = createFixture();
    void fixture.client.start();
    await vi.waitFor(() => expect(fixture.client.getSnapshot().status).toBe('listening'));
    fixture.socket.open();
    expect(fixture.socket.sent).toHaveLength(1);

    await fixture.client.cancel();

    expect(fixture.client.getSnapshot().status).toBe('idle');
    expect(fixture.socket.sent).toHaveLength(1);
    expect(fixture.socket.close).toHaveBeenCalledWith(1000, 'dictation_finished');
  });

  it('keeps final text and drops only partial text on cancel', async () => {
    const fixture = createFixture();
    await fixture.start();
    fixture.socket.serverEvent({
      segmentId: 'segment-1',
      sequence: 2,
      sessionId: SESSION_ID,
      text: 'confirmed',
      type: 'transcript.final',
    });
    fixture.socket.serverEvent({
      segmentId: 'segment-2',
      sequence: 3,
      sessionId: SESSION_ID,
      text: 'temporary',
      type: 'transcript.partial',
    });

    await fixture.client.cancel();

    expect(fixture.editor.finalize).toHaveBeenCalledWith('confirmed');
    expect(JSON.parse(fixture.socket.sent.at(-1) as string)).toEqual({
      reason: 'user_cancelled',
      type: 'session.cancel',
    });
    expect(fixture.client.getSnapshot().status).toBe('finalizing');
    expect(fixture.socket.close).not.toHaveBeenCalled();
    fixture.socket.serverEvent({
      forwardedAudioMs: 400,
      sequence: 4,
      sessionId: SESSION_ID,
      type: 'session.cancelled',
    });
    await vi.waitFor(() => expect(fixture.client.getSnapshot().status).toBe('idle'));
    expect(fixture.socket.close).toHaveBeenCalledWith(1000, 'dictation_finished');
  });

  it('keeps the ready session finalizing when cancel replaces an in-flight end', async () => {
    const fixture = createFixture();
    await fixture.start();
    await fixture.client.stop();

    expect(fixture.client.getSnapshot().status).toBe('finalizing');
    expect(sentControls(fixture.socket).at(-1)).toMatchObject({ type: 'session.end' });

    await fixture.client.cancel('audio_interruption');

    expect(fixture.client.getSnapshot().status).toBe('finalizing');
    expect(JSON.parse(fixture.socket.sent.at(-1) as string)).toEqual({
      reason: 'audio_interruption',
      type: 'session.cancel',
    });
    expect(fixture.socket.close).not.toHaveBeenCalled();

    fixture.socket.serverEvent({
      forwardedAudioMs: 0,
      sequence: 2,
      sessionId: SESSION_ID,
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
      sessionId: OLD_SESSION_ID,
      text: 'old',
      type: 'transcript.partial',
    });
    fixture.socket.serverEvent({
      segmentId: 'segment-1',
      sequence: 3,
      sessionId: SESSION_ID,
      text: 'new',
      type: 'transcript.partial',
    });
    fixture.socket.serverEvent({
      segmentId: 'segment-1',
      sequence: 3,
      sessionId: SESSION_ID,
      text: 'duplicate',
      type: 'transcript.partial',
    });
    fixture.socket.serverEvent({
      segmentId: 'segment-1',
      sequence: 2,
      sessionId: SESSION_ID,
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
      sessionId: SESSION_ID,
      text: 'confirmed',
      type: 'transcript.final',
    });

    fixture.onUserEdit();
    await vi.waitFor(() => expect(fixture.client.getSnapshot().status).toBe('finalizing'));
    await vi.waitFor(() => expect(fixture.socket.sent).toHaveLength(3));

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
      sessionId: SESSION_ID,
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
      sessionId: SESSION_ID,
      text: 'temporary',
      type: 'transcript.partial',
    });
    fixture.socket.serverEvent({
      code: 'PROVIDER_CAPACITY',
      retryable: true,
      sequence: 3,
      sessionId: SESSION_ID,
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
    fixture.socket.serverEvent(ready(2));
    await fixture.client.stop();

    await vi.advanceTimersByTimeAsync(REALTIME_ASR_LIMITS.finalTimeoutMs);

    expect(fixture.client.getSnapshot()).toMatchObject({
      errorCode: 'FINAL_TIMEOUT',
      retryable: true,
      status: 'error',
    });
  });

  it('waits for the Provider before timing out a release that came before session.ready', async () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    await fixture.start();
    await fixture.client.stop();

    await vi.advanceTimersByTimeAsync(REALTIME_ASR_LIMITS.finalTimeoutMs);
    expect(fixture.client.getSnapshot().status).toBe('finalizing');
  });

  it('fails at once when the held connection closed while the microphone prompt was open', async () => {
    let grant!: (stream: MediaStream) => void;
    const fixture = createFixture(
      () =>
        new Promise<MediaStream>((resolve) => {
          grant = resolve;
        }),
    );
    const starting = fixture.client.start();
    await fixture.handshake();
    fixture.socket.readyState = 3;
    grant(fixture.stream);
    await starting;

    expect(fixture.client.getSnapshot()).toMatchObject({ errorCode: 'NETWORK_DISCONNECTED' });
    expect(sentControls(fixture.socket).map(({ type }) => type)).not.toContain('session.start');
  });

  it('closes a connection that resolved before the microphone was denied', async () => {
    let deny!: (error: Error) => void;
    const fixture = createFixture(
      () =>
        new Promise<MediaStream>((_, reject) => {
          deny = reject;
        }),
    );
    const starting = fixture.client.start();
    await fixture.handshake();
    deny(new DOMException('denied', 'NotAllowedError'));
    await starting;

    await vi.waitFor(() =>
      expect(fixture.socket.close).toHaveBeenCalledWith(1000, 'dictation_finished'),
    );
  });

  it('fails instead of growing the send queue without bound', async () => {
    const fixture = createFixture();
    await fixture.start();
    fixture.socket.bufferedAmount =
      REALTIME_ASR_AUDIO.frameBytes * REALTIME_ASR_DEFERRED_LIMITS.maxPrerollFrames;

    for (let index = 0; index <= REALTIME_ASR_DEFERRED_LIMITS.maxPrerollFrames; index += 1) {
      fixture.emitFrame(new ArrayBuffer(6400));
    }

    await vi.waitFor(() => expect(fixture.client.getSnapshot().status).toBe('error'));
    expect(fixture.client.getSnapshot().errorCode).toBe('BACKPRESSURE');
  });

  it('buffers audio captured before the Gateway accepts and flushes it after session.start', async () => {
    const fixture = createFixture();
    const starting = fixture.client.start();
    await vi.waitFor(() => expect(fixture.client.getSnapshot().status).toBe('listening'));
    fixture.emitFrame(new ArrayBuffer(6400));
    fixture.emitFrame(new ArrayBuffer(6400));
    expect(fixture.socket.sent.filter((data) => typeof data !== 'string')).toHaveLength(0);

    await fixture.handshake();
    await starting;

    const startIndex = fixture.socket.sent.findIndex(
      (data) => typeof data === 'string' && data.includes('session.start'),
    );
    expect(startIndex).toBeGreaterThan(0);
    expect(
      fixture.socket.sent.slice(startIndex + 1).filter((data) => data instanceof ArrayBuffer),
    ).toHaveLength(2);
  });

  it('ends a session released before the Gateway accepts once it is connected', async () => {
    const fixture = createFixture();
    const starting = fixture.client.start();
    await vi.waitFor(() => expect(fixture.client.getSnapshot().status).toBe('listening'));
    fixture.emitFrame(new ArrayBuffer(6400));
    const stopping = fixture.client.stop();
    expect(fixture.client.getSnapshot().status).toBe('finalizing');

    await fixture.handshake();
    await Promise.all([starting, stopping]);

    expect(sentControls(fixture.socket).map(({ type }) => type)).toEqual([
      'session.auth',
      'session.start',
      'session.end',
    ]);
  });

  it('hands a prefetched session to the next press without admitting again', async () => {
    const fixture = createFixture();
    const prefetching = fixture.client.prefetch();
    await fixture.handshake();
    await prefetching;
    expect(fixture.client.getSnapshot().status).toBe('idle');

    await fixture.client.start();

    expect(fixture.createSession).toHaveBeenCalledOnce();
    expect(fixture.createWebSocket).toHaveBeenCalledOnce();
    expect(sentControls(fixture.socket).at(-1)).toEqual({ type: 'session.start' });
    expect(fixture.client.getSnapshot().status).toBe('listening');
  });

  it('drops a prefetched session the Gateway expires while idle', async () => {
    const fixture = createFixture();
    const prefetching = fixture.client.prefetch();
    await fixture.handshake();
    await prefetching;

    fixture.socket.serverEvent({
      code: 'SESSION_EXPIRED',
      retryable: true,
      sequence: 2,
      sessionId: SESSION_ID,
      type: 'session.error',
    });
    expect(fixture.socket.close).toHaveBeenCalledWith(1000, 'dictation_finished');

    const fresh = new FakeSocket();
    fixture.createWebSocket.mockReturnValueOnce(fresh as unknown as RealtimeAsrWebSocket);
    const starting = fixture.client.start();
    await vi.waitFor(() => expect(fixture.createWebSocket).toHaveBeenCalledTimes(2));
    fresh.open();
    fresh.serverEvent(accepted());
    await starting;
    expect(fixture.createSession).toHaveBeenCalledTimes(2);
  });

  it('falls back to the legacy flow when the Gateway does not support deferred start', async () => {
    const fixture = createFixture();
    const prefetching = fixture.client.prefetch();
    await fixture.handshake(ready());
    await prefetching;
    expect(fixture.socket.close).toHaveBeenCalledWith(1000, 'dictation_finished');

    await fixture.client.prefetch();
    expect(fixture.createSession).toHaveBeenCalledOnce();

    const legacy = new FakeSocket();
    fixture.createWebSocket.mockReturnValueOnce(legacy as unknown as RealtimeAsrWebSocket);
    const starting = fixture.client.start();
    await vi.waitFor(() => expect(fixture.client.getSnapshot().status).toBe('listening'));
    for (let index = 0; index < 8; index += 1) fixture.emitFrame(new ArrayBuffer(6400));
    await vi.waitFor(() => expect(fixture.createWebSocket).toHaveBeenCalledTimes(2));
    legacy.open();
    legacy.serverEvent(ready());
    await starting;

    expect(sentControls(legacy).map(({ type }) => type)).toEqual(['session.auth']);
    expect(legacy.sent.filter((data) => data instanceof ArrayBuffer)).toHaveLength(2);
  });
});
