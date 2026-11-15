import { EventEmitter } from 'node:events';

import { ParticipantKind, type Room, RoomEvent } from 'livekit-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VoiceWorkerUnavailableError, waitForVoiceWorker } from './waitForWorker';

const setup = () => Object.assign(new EventEmitter(), { remoteParticipants: new Map() });
afterEach(() => vi.useRealTimers());

describe('voice worker readiness', () => {
  it('waits through startup until the agent pipeline is ready', async () => {
    const room = setup();
    const worker = {
      kind: ParticipantKind.AGENT,
      attributes: { 'lk.agent.state': 'initializing' },
    };
    room.remoteParticipants.set('worker', worker);
    let ready = false;
    const result = waitForVoiceWorker(room as unknown as Room, new AbortController().signal).then(
      () => {
        ready = true;
      },
    );
    await Promise.resolve();
    expect(ready).toBe(false);
    worker.attributes['lk.agent.state'] = 'listening';
    room.emit(RoomEvent.ParticipantAttributesChanged, worker.attributes, worker);
    await result;
    expect(ready).toBe(true);
    expect(room.listenerCount(RoomEvent.ParticipantAttributesChanged)).toBe(0);
  });
  it('times out a missing or crashed worker instead of staying connecting', async () => {
    vi.useFakeTimers();
    const room = setup();
    const result = waitForVoiceWorker(room as unknown as Room, new AbortController().signal);
    const rejection = expect(result).rejects.toBeInstanceOf(VoiceWorkerUnavailableError);
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(room.eventNames()).toEqual([]);
  });
  it('releases listeners and the timeout when the call closes', async () => {
    const room = setup();
    const controller = new AbortController();
    const result = waitForVoiceWorker(room as unknown as Room, controller.signal);
    controller.abort();
    await expect(result).rejects.toThrow();
    expect(room.eventNames()).toEqual([]);
  });
});
