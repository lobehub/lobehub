import { isDesktop } from '@lobechat/const';
import debug from 'debug';

import { electronLocalAsrService } from '@/services/electron/localAsr';
import {
  createLocalBatchTranscriber,
  createRealtimeTranscriber,
  resolveTranscriptionProvider,
} from '@/services/transcriber';

import type { LocalTranscriptionSession } from './engine/controller';

const log = debug('lobe-meeting:local');

/**
 * The on-device meeting session when the user picked local transcription in
 * Settings → Transcription and the speech model is installed; otherwise
 * `undefined`, and the recorder uses the cloud. Speakers are separated when
 * diarization is on and its optional model pack is installed.
 */
export const createLocalMeetingSession = async (): Promise<
  LocalTranscriptionSession | undefined
> => {
  if (!isDesktop) return undefined;

  const status = await electronLocalAsrService.getStatus();
  if (resolveTranscriptionProvider(status) !== 'local') return undefined;

  const diarize =
    status.preferences.diarization &&
    status.packs.some((pack) => pack.id === 'diarization' && pack.status === 'ready');
  const language = status.preferences.language;
  const realtime = createRealtimeTranscriber('local');

  return {
    cancel: () => realtime.cancel(),
    pause: () => realtime.pause(),
    pushFrame: (frame) => realtime.pushFrame(frame),
    refine: async (audioPath) => {
      const { audioMs, segments, speakers, stats } = await createLocalBatchTranscriber().transcribe(
        {
          diarize,
          filePath: audioPath,
          language,
        },
      );
      log(
        'refine %s: %dms audio, %d segments, %d speakers, stats %o',
        audioPath,
        audioMs,
        segments.length,
        speakers.length,
        stats,
      );
      return segments.map(({ endMs, speaker, startMs, text }) => ({
        endMs: Math.round(endMs ?? startMs ?? 0),
        speakerLabel: speaker,
        startMs: Math.round(startMs ?? 0),
        text,
      }));
    },
    resume: () => realtime.resume(),
    start: ({ onError, onFinal }) =>
      realtime.start({ language, onError, onFinal, recordAudio: true }),
    stop: async () => {
      const result = await realtime.stop();
      log('live session stopped: %o', result);
      return result;
    },
  };
};
