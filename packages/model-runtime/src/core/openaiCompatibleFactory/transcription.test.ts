import { describe, expect, it } from 'vitest';

import { toASRSegments, toTranscriptionParams } from './transcription';

describe('toTranscriptionParams', () => {
  const file = new File([new Uint8Array([1])], 'a.wav', { type: 'audio/wav' });

  it('forwards diarization options as the OpenAI fields', () => {
    expect(
      toTranscriptionParams(
        {
          chunkingStrategy: 'auto',
          file,
          knownSpeakers: [
            { name: 'S1', reference: 'data:audio/wav;base64,AAA' },
            { name: 'S2', reference: 'data:audio/wav;base64,BBB' },
          ],
          language: 'zh',
          model: 'ignored',
          responseFormat: 'diarized_json',
        },
        file,
        'gpt-4o-transcribe-diarize',
      ),
    ).toMatchObject({
      chunking_strategy: 'auto',
      file,
      known_speaker_names: ['S1', 'S2'],
      known_speaker_references: ['data:audio/wav;base64,AAA', 'data:audio/wav;base64,BBB'],
      language: 'zh',
      model: 'gpt-4o-transcribe-diarize',
      response_format: 'diarized_json',
    });
  });

  it('omits speaker fields when no speakers are known', () => {
    const params = toTranscriptionParams({ file, knownSpeakers: [], model: 'm' }, file, 'm');
    expect(params.known_speaker_names).toBeUndefined();
    expect(params.known_speaker_references).toBeUndefined();
  });
});

describe('toASRSegments', () => {
  it('reads diarized segments with their speakers', () => {
    expect(
      toASRSegments({
        duration: 12.5,
        segments: [
          { end: 4, id: 'a', speaker: 'A', start: 0, text: 'hi', type: 'transcript.text.segment' },
          { end: 9, id: 'b', speaker: 'B', start: 4.2, text: 'there' },
        ],
        text: 'hi there',
      }),
    ).toEqual({
      duration: 12.5,
      segments: [
        { end: 4, speaker: 'A', start: 0, text: 'hi' },
        { end: 9, speaker: 'B', start: 4.2, text: 'there' },
      ],
    });
  });

  it('reads verbose_json segments without speakers and skips malformed ones', () => {
    expect(
      toASRSegments({ segments: [{ end: 2, start: 0, text: 'ok' }, { start: 'x' }, null] }),
    ).toEqual({ segments: [{ end: 2, start: 0, text: 'ok' }] });
  });

  it('returns nothing for plain text responses', () => {
    expect(toASRSegments('hello')).toEqual({});
    expect(toASRSegments({ text: 'hello' })).toEqual({});
  });
});
