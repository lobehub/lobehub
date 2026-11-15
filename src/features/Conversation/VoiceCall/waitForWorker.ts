import { ParticipantKind, type Room, RoomEvent } from 'livekit-client';

export class VoiceWorkerUnavailableError extends Error {
  constructor() {
    super('No ready LobeHub worker joined this LiveKit server');
  }
}

/** Agent presence alone is insufficient: startup may fail before its pipeline is ready. */
export const waitForVoiceWorker = (
  room: Room,
  signal: AbortSignal,
  timeoutMs = 30_000,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const ready = () =>
      [...room.remoteParticipants.values()].some(
        (p) =>
          p.kind === ParticipantKind.AGENT &&
          ['listening', 'thinking', 'speaking', 'idle'].includes(p.attributes['lk.agent.state']),
      );
    const cleanup = () => {
      clearTimeout(timer);
      room.off(RoomEvent.ParticipantConnected, check);
      room.off(RoomEvent.ParticipantAttributesChanged, check);
      signal.removeEventListener('abort', abort);
    };
    const check = () => {
      if (ready()) {
        cleanup();
        resolve();
      }
    };
    const abort = () => {
      cleanup();
      reject(signal.reason ?? new Error('Connection cancelled'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new VoiceWorkerUnavailableError());
    }, timeoutMs);
    room.on(RoomEvent.ParticipantConnected, check);
    room.on(RoomEvent.ParticipantAttributesChanged, check);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else check();
  });
