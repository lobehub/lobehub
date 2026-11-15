import { randomUUID } from 'node:crypto';
import { ReadableStream } from 'node:stream/web';

import { type Room, RoomEvent } from '@livekit/rtc-node';
import {
  SPEECH_REQUEST_TOPIC,
  SPEECH_RESPONSE_TOPIC,
  speechRequestSchema,
  type SpeechResponse,
  speechResponseSchema,
  VOICE_CANCEL_METHOD,
  VOICE_RESULT_TOPIC,
  VOICE_TURN_METHOD,
  VOICE_TURN_TIMEOUT_MS,
  voiceResultSchema,
  voiceTurnSchema,
} from '@lobechat/livekit-bridge';

/** Speech turns are delegated to the authenticated browser's LobeHub runtime. */
export class LobeHubBridge {
  private readonly pending = new Map<
    string,
    { resolve: (text: string) => void; reject: (error: Error) => void }
  >();

  private readonly speechPending = new Map<
    string,
    { resolve: (value: SpeechResponse) => void; reject: (error: Error) => void }
  >();

  constructor(
    private readonly room: Room,
    private readonly identity: string,
  ) {
    room.registerTextStreamHandler(VOICE_RESULT_TOPIC, (reader, participant) => {
      if (participant.identity !== identity) return;
      void (async () => {
        let text = '';
        for await (const chunk of reader) {
          text += chunk;
          if (text.length > 110_000) throw new Error('Voice reply is too large');
        }
        const result = voiceResultSchema.parse(JSON.parse(text));
        const pending = this.pending.get(result.requestId);
        if (!pending) return;
        if (result.ok) pending.resolve(result.text);
        else pending.reject(new Error('The LobeHub agent turn failed'));
      })().catch(() => {
        for (const pending of this.pending.values())
          pending.reject(new Error('Invalid voice reply'));
      });
    });
    room.registerTextStreamHandler(SPEECH_RESPONSE_TOPIC, (reader, participant) => {
      if (participant.identity !== identity) return;
      void (async () => {
        let payload = '';
        for await (const chunk of reader) {
          payload += chunk;
          if (payload.length > 16_100_000) throw new Error('Speech response is too large');
        }
        const result = speechResponseSchema.parse(JSON.parse(payload));
        const pending = this.speechPending.get(result.requestId);
        if (result.ok) pending?.resolve(result);
        else pending?.reject(new Error('Speech provider request failed'));
      })().catch(() => {
        for (const pending of this.speechPending.values())
          pending.reject(new Error('Invalid speech response'));
      });
    });
    room.on(RoomEvent.Disconnected, () => this.close());
    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      if (participant.identity === identity) this.close();
    });
  }

  async requestSpeech(
    input: { kind: 'asr'; audioBase64: string } | { kind: 'tts'; text: string },
    signal?: AbortSignal,
  ): Promise<SpeechResponse> {
    signal?.throwIfAborted();
    const request = speechRequestSchema.parse({ ...input, requestId: randomUUID() });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      return await new Promise<SpeechResponse>((resolve, reject) => {
        this.speechPending.set(request.requestId, { resolve, reject });
        timer = setTimeout(() => reject(new Error('Speech request timed out')), 60_000);
        abort = () => reject(new Error('Speech request cancelled'));
        signal?.addEventListener('abort', abort, { once: true });
        const participant = this.room.localParticipant;
        if (!participant) return reject(new Error('Worker is not connected'));
        void participant
          .sendText(JSON.stringify(request), {
            destinationIdentities: [this.identity],
            topic: SPEECH_REQUEST_TOPIC,
          })
          .catch(reject);
      });
    } finally {
      clearTimeout(timer);
      if (abort) signal?.removeEventListener('abort', abort);
      this.speechPending.delete(request.requestId);
    }
  }

  run(text: string): ReadableStream<string> {
    const requestId = randomUUID();
    const request = voiceTurnSchema.parse({ requestId, text });
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const cancelTurn = () => {
      void this.room.localParticipant
        ?.performRpc({
          destinationIdentity: this.identity,
          method: VOICE_CANCEL_METHOD,
          payload: JSON.stringify({ requestId }),
        })
        .catch(() => {});
    };
    return new ReadableStream<string>({
      start: (controller) => {
        const result = new Promise<string>((resolve, reject) => {
          this.pending.set(requestId, { resolve, reject });
          timer = setTimeout(() => {
            cancelTurn();
            reject(new Error('The agent turn timed out'));
          }, VOICE_TURN_TIMEOUT_MS);
        });
        void (async () => {
          try {
            const participant = this.room.localParticipant;
            if (!participant) throw new Error('Voice worker is not connected');
            await participant.performRpc({
              destinationIdentity: this.identity,
              method: VOICE_TURN_METHOD,
              payload: JSON.stringify(request),
            });
          } catch (error) {
            this.pending
              .get(requestId)
              ?.reject(error instanceof Error ? error : new Error('Voice bridge failed'));
          }
        })();
        void result
          .then(
            (reply) => {
              if (!cancelled) {
                controller.enqueue(reply);
                controller.close();
              }
            },
            (error: Error) => {
              if (!cancelled) controller.error(error);
            },
          )
          .finally(() => {
            clearTimeout(timer);
            this.pending.delete(requestId);
          });
      },
      cancel: () => {
        cancelled = true;
        cancelTurn();
        this.pending.get(requestId)?.reject(new Error('Voice turn interrupted'));
      },
    });
  }

  close() {
    for (const pending of this.speechPending.values()) pending.reject(new Error('Call ended'));
    this.speechPending.clear();
    for (const pending of this.pending.values()) pending.reject(new Error('Call ended'));
    this.pending.clear();
  }
}
