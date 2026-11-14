import type OpenAI from 'openai';

import type { ASRPayload, ASRResponse, ASRSegment } from '../../types/asr';

type TranscriptionParams = OpenAI.Audio.TranscriptionCreateParamsNonStreaming;

/** Map an `ASRPayload` onto the OpenAI `audio.transcriptions.create` body. */
export const toTranscriptionParams = (
  payload: ASRPayload,
  file: File,
  model: string,
): TranscriptionParams => {
  const { chunkingStrategy, knownSpeakers, language, prompt, responseFormat, temperature } =
    payload;
  const hasKnownSpeakers = !!knownSpeakers?.length;

  return {
    chunking_strategy: chunkingStrategy,
    file,
    known_speaker_names: hasKnownSpeakers ? knownSpeakers.map((s) => s.name) : undefined,
    known_speaker_references: hasKnownSpeakers ? knownSpeakers.map((s) => s.reference) : undefined,
    language,
    model,
    prompt,
    response_format: responseFormat,
    temperature,
  } as TranscriptionParams;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Pick the timed segments out of a `verbose_json` / `diarized_json` response.
 * Plain `json` / `text` responses carry none, so the result is empty.
 */
export const toASRSegments = (
  transcription: unknown,
): Pick<ASRResponse, 'duration' | 'segments'> => {
  if (!transcription || typeof transcription !== 'object') return {};

  const { duration, segments } = transcription as { duration?: unknown; segments?: unknown };
  const result: Pick<ASRResponse, 'duration' | 'segments'> = {};
  if (isFiniteNumber(duration)) result.duration = duration;

  if (Array.isArray(segments)) {
    result.segments = segments.flatMap((segment): ASRSegment[] => {
      if (!segment || typeof segment !== 'object') return [];
      const { end, speaker, start, text } = segment as Record<string, unknown>;
      if (!isFiniteNumber(start) || !isFiniteNumber(end) || typeof text !== 'string') return [];

      return [
        {
          end,
          ...(typeof speaker === 'string' && speaker ? { speaker } : {}),
          start,
          text,
        },
      ];
    });
  }

  return result;
};
