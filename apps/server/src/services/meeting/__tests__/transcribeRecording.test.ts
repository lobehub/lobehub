import type { ASRPayload, ASRResponse } from '@lobechat/model-runtime';
import { AgentRuntimeErrorType } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { MeetingTranscriptionError, toMeetingErrorCode } from '../errors';
import { transcribeRecording } from '../transcribeRecording';
import type { PcmAudio } from '../wav';
import { durationMs, encodePcmWav, parsePcmWav, planChunks } from '../wav';

const RATE = 16_000;

/**
 * Synthetic mono recording: `loud` spans hold a tone, everything else is
 * silence, so chunk cuts must land in the silent gaps.
 */
const makeAudio = (seconds: number, loud: [number, number][]): PcmAudio => {
  const samples = new Int16Array(seconds * RATE);
  for (const [from, to] of loud) {
    for (let index = from * RATE; index < to * RATE; index += 1) {
      samples[index] = Math.round(Math.sin(index / 5) * 8000);
    }
  }
  return { channels: 1, sampleRate: RATE, samples };
};

const wavSeconds = (file: Blob) => (file.size - 44) / 2 / RATE;

describe('wav', () => {
  it('round-trips 16-bit PCM and rejects other containers', () => {
    const audio = makeAudio(2, [[0, 1]]);
    const parsed = parsePcmWav(encodePcmWav(audio))!;

    expect(parsed.sampleRate).toBe(RATE);
    expect(parsed.samples).toEqual(audio.samples);
    expect(durationMs(parsed)).toBe(2000);
    expect(
      parsePcmWav(new TextEncoder().encode('ID3 not a wav file at all, just some bytes....')),
    ).toBe(undefined);
  });

  it('reads a recording whose header size was never patched', () => {
    const bytes = encodePcmWav(makeAudio(1, []));
    new DataView(bytes.buffer).setUint32(40, 0, true);
    expect(parsePcmWav(bytes)!.samples).toHaveLength(RATE);
  });

  it('cuts chunks at pauses, within the limit, covering every sample once', () => {
    // Speech everywhere except a quiet gap around 55 s and 110 s.
    const audio = makeAudio(150, [
      [0, 54.5],
      [55.5, 109.5],
      [110.5, 150],
    ]);
    const chunks = planChunks(audio, { maxChunkMs: 60_000 });

    expect(chunks[0].start).toBe(0);
    expect(chunks.at(-1)!.end).toBe(150 * RATE);
    chunks.forEach((chunk, index) => {
      if (index > 0) expect(chunk.start).toBe(chunks[index - 1].end);
      expect(chunk.end - chunk.start).toBeLessThanOrEqual(60 * RATE);
    });
    expect(chunks[0].end / RATE).toBeGreaterThan(54.5);
    expect(chunks[0].end / RATE).toBeLessThan(55.5);
    expect(chunks[1].end / RATE).toBeGreaterThan(109.5);
    expect(chunks[1].end / RATE).toBeLessThan(110.5);
  });
});

describe('transcribeRecording', () => {
  it('refines a long recording chunk by chunk with stable speakers and absolute timestamps', async () => {
    const audio = makeAudio(150, [
      [0, 54.5],
      [55.5, 114.5],
      [115.5, 150],
    ]);
    const payloads: Omit<ASRPayload, 'model'>[] = [];
    const transcribe = vi.fn(async (payload: Omit<ASRPayload, 'model'>): Promise<ASRResponse> => {
      payloads.push(payload);
      const seconds = wavSeconds(payload.file);
      const known = payload.knownSpeakers?.map((speaker) => speaker.name) ?? [];
      // The provider labels voices it knows by name, any other voice A, B, …
      const first = known[0] ?? 'A';
      const second = known[1] ?? 'B';
      return {
        segments: [
          { end: seconds / 2, speaker: first, start: 0.5, text: ` part ${payloads.length} one ` },
          {
            end: seconds - 0.5,
            speaker: second,
            start: seconds / 2,
            text: `part ${payloads.length} two`,
          },
        ],
        text: '',
      };
    });

    const progress: number[] = [];
    const segments = await transcribeRecording({
      bytes: encodePcmWav(audio),
      fileName: 'meeting.wav',
      language: 'zh',
      maxChunkMs: 60_000,
      model: 'gpt-4o-transcribe-diarize',
      onProgress: (done) => progress.push(done),
      transcribe,
    });

    expect(transcribe).toHaveBeenCalledTimes(3);
    expect(progress).toEqual([1, 2, 3]);
    expect(payloads[0]).toMatchObject({
      chunkingStrategy: 'auto',
      language: 'zh',
      responseFormat: 'diarized_json',
    });
    expect(payloads[0].knownSpeakers).toBeUndefined();
    // Later chunks carry samples of the voices from the first one.
    expect(payloads[1].knownSpeakers?.map((s) => s.name)).toEqual(['S1', 'S2']);
    expect(payloads[1].knownSpeakers?.[0].reference).toMatch(/^data:audio\/wav;base64,/);

    expect(segments).toHaveLength(6);
    expect(new Set(segments.map((s) => s.speakerLabel))).toEqual(new Set(['S1', 'S2']));
    expect(segments[0]).toEqual({
      endMs: expect.any(Number),
      speakerLabel: 'S1',
      startMs: 500,
      text: 'part 1 one',
    });
    // Offsets of later chunks are shifted to the recording timeline and stay ordered.
    const starts = segments.map((s) => s.startMs);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    expect(segments[2].startMs).toBeGreaterThan(54_000);
    expect(segments.at(-1)!.endMs).toBeLessThanOrEqual(150_000);
  });

  it('gives voices new to a later chunk their own speaker number', async () => {
    const audio = makeAudio(120, [
      [0, 59.5],
      [60.5, 120],
    ]);
    let call = 0;
    const segments = await transcribeRecording({
      bytes: encodePcmWav(audio),
      fileName: 'meeting.wav',
      maxChunkMs: 61_000,
      model: 'gpt-4o-transcribe-diarize',
      transcribe: async () => {
        call += 1;
        return call === 1
          ? { segments: [{ end: 10, speaker: 'A', start: 0, text: 'hello' }], text: '' }
          : {
              segments: [
                { end: 5, speaker: 'S1', start: 0, text: 'again' },
                { end: 9, speaker: 'A', start: 6, text: 'newcomer' },
              ],
              text: '',
            };
      },
    });

    expect(segments.map((s) => [s.text, s.speakerLabel])).toEqual([
      ['hello', 'S1'],
      ['again', 'S1'],
      ['newcomer', 'S2'],
    ]);
  });

  it('keeps text from a provider without timestamps as one segment per chunk', async () => {
    const segments = await transcribeRecording({
      bytes: encodePcmWav(makeAudio(10, [[0, 10]])),
      fileName: 'meeting.wav',
      model: 'gpt-4o-mini-transcribe',
      transcribe: async (payload) => {
        expect(payload.responseFormat).toBe('json');
        return { text: ' all of it ' };
      },
    });

    expect(segments).toEqual([{ endMs: 10_000, startMs: 0, text: 'all of it' }]);
  });

  it('sends a non-WAV recording whole', async () => {
    const transcribe = vi.fn(async () => ({
      duration: 4,
      segments: [{ end: 3, speaker: 'A', start: 1, text: 'hi' }],
      text: 'hi',
    }));
    const segments = await transcribeRecording({
      bytes: new Uint8Array([1, 2, 3, 4]),
      fileName: 'meeting.webm',
      mimeType: 'audio/webm',
      model: 'gpt-4o-transcribe-diarize',
      transcribe,
    });

    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(segments).toEqual([{ endMs: 3000, speakerLabel: 'S1', startMs: 1000, text: 'hi' }]);
  });

  it('fails the whole pass when any chunk fails, so no speech is silently dropped', async () => {
    const audio = makeAudio(130, [[0, 130]]);
    let call = 0;
    await expect(
      transcribeRecording({
        bytes: encodePcmWav(audio),
        fileName: 'meeting.wav',
        maxChunkMs: 60_000,
        model: 'whisper-1',
        transcribe: async () => {
          call += 1;
          if (call === 2) {
            throw {
              error: { message: 'quota' },
              errorType: AgentRuntimeErrorType.InsufficientQuota,
            };
          }
          return { segments: [], text: '' };
        },
      }),
    ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.InsufficientQuota });
  });

  it('rejects an empty recording and a provider without speech-to-text', async () => {
    await expect(
      transcribeRecording({
        bytes: new Uint8Array(),
        fileName: 'x.wav',
        model: 'm',
        transcribe: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'audio_missing' });

    await expect(
      transcribeRecording({
        bytes: encodePcmWav(makeAudio(1, [[0, 1]])),
        fileName: 'x.wav',
        model: 'm',
        transcribe: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'provider_not_configured' });
  });
});

describe('toMeetingErrorCode', () => {
  it.each([
    [{ errorType: AgentRuntimeErrorType.InvalidProviderAPIKey }, 'provider_not_configured'],
    [{ errorType: AgentRuntimeErrorType.NoOpenAIAPIKey }, 'provider_not_configured'],
    [{ errorType: AgentRuntimeErrorType.InsufficientQuota }, 'quota_exceeded'],
    [{ errorType: 'InsufficientBudgetForModel' }, 'quota_exceeded'],
    [{ errorType: AgentRuntimeErrorType.ProviderNetworkError }, 'provider_unavailable'],
    [{ errorType: AgentRuntimeErrorType.RateLimitExceeded }, 'provider_unavailable'],
    [new MeetingTranscriptionError('audio_missing'), 'audio_missing'],
    [new Error('boom'), 'transcription_failed'],
  ])('maps %o to %s', (error, code) => {
    expect(toMeetingErrorCode(error)).toBe(code);
  });
});
