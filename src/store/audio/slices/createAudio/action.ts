import { lambdaClient } from '@/libs/trpc/client';
import { setNamespace } from '@/utils/storeDebug';

import { type AudioStore } from '../../store';
import { type AudioTrack } from './initialState';

const n = setNamespace('createAudio');

const POLL_MIN_MS = 2000;
const POLL_MAX_MS = 5000;
const EARLY_PLAY_AFTER_MS = 15_000;
const MAX_POLL_ATTEMPTS = 60;

const randomPollInterval = () =>
  POLL_MIN_MS + Math.random() * (POLL_MAX_MS - POLL_MIN_MS);

const pollingTimers = new Map<string, ReturnType<typeof setTimeout>>();

export interface CreateAudioAction {
  generateAudio: () => Promise<void>;
  stopPolling: (taskId: string) => void;
  updateAudioTrack: (taskId: string, patch: Partial<AudioTrack>) => void;
  clearFinishedTracks: () => void;
  setIsGenerating: (generating: boolean) => void;
  setGenerationError: (error: string | null) => void;
}

type Setter = (
  patch: Partial<AudioStore> | ((s: AudioStore) => Partial<AudioStore>),
  replace?: boolean,
  name?: string,
) => void;

export const createCreateAudioSlice = (set: Setter, get: () => AudioStore) =>
  ({
    setIsGenerating: (generating) => {
      set({ isGenerating: generating }, false, n('setIsGenerating'));
    },

    setGenerationError: (error) => {
      set({ generationError: error }, false, n('setGenerationError'));
    },

    updateAudioTrack: (taskId, patch) => {
      set(
        (s) => ({
          audioTracks: { ...s.audioTracks, [taskId]: { ...s.audioTracks[taskId], ...patch } },
        }),
        false,
        n('updateAudioTrack'),
      );
    },

    stopPolling: (taskId) => {
      const timer = pollingTimers.get(taskId);
      if (timer) {
        clearTimeout(timer);
        pollingTimers.delete(taskId);
      }
    },

    clearFinishedTracks: () => {
      set(
        (s) => ({
          audioTracks: Object.fromEntries(
            Object.entries(s.audioTracks).filter(
              ([, t]) => t.status !== 'completed' && t.status !== 'failed',
            ),
          ),
        }),
        false,
        n('clearFinishedTracks'),
      );
    },

    generateAudio: async () => {
      const state = get();
      const { prompt, customMode, songTitle, stylePrompt, makeInstrumental } = state;
      if (!prompt?.trim()) return;

      set({ isGenerating: true, generationError: null }, false, n('start'));

      try {
        const result = await lambdaClient.audio.generateAudio.mutate({
          prompt: prompt.trim(),
          customMode,
          style: customMode ? stylePrompt : undefined,
          title: customMode ? songTitle : undefined,
          makeInstrumental,
        });

        const track: AudioTrack = {
          audioId: result.audioId,
          taskId: result.taskId,
          prompt: prompt.trim(),
          status: 'pending',
          progress: 0,
          canPlayEarly: false,
          createdAt: result.createdAt ? new Date(result.createdAt) : new Date(),
        };

        set(
          (s) => ({
            isGenerating: false,
            audioTracks: { ...s.audioTracks, [result.taskId]: track },
          }),
          false,
          n('created'),
        );

        _startPolling(result.taskId, new Date(), 0, get, set);
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to generate audio';
        set({ isGenerating: false, generationError: msg }, false, n('error'));
      }
    },
  }) as CreateAudioAction;

function _startPolling(
  taskId: string,
  startTime: Date,
  attempt: number,
  get: () => AudioStore,
  set: Setter,
) {
  if (attempt >= MAX_POLL_ATTEMPTS) {
    set(
      (s) => ({
        audioTracks: {
          ...s.audioTracks,
          [taskId]: { ...s.audioTracks[taskId], status: 'failed' },
        },
      }),
      false,
      'poll/timeout',
    );
    return;
  }

  const timer = setTimeout(async () => {
    pollingTimers.delete(taskId);
    const current = get().audioTracks[taskId];
    if (!current || current.status === 'completed' || current.status === 'failed') return;

    try {
      const status = await lambdaClient.audio.getAudioStatus.query({ taskId });
      const elapsed = Date.now() - startTime.getTime();
      const canPlayEarly = elapsed >= EARLY_PLAY_AFTER_MS && !!status.audioUrl;

      set(
        (s) => ({
          audioTracks: {
            ...s.audioTracks,
            [taskId]: {
              ...s.audioTracks[taskId],
              status: status.status as AudioTrack['status'],
              audioUrl: status.audioUrl ?? s.audioTracks[taskId]?.audioUrl,
              imageUrl:
                (status.metadata as any)?.imageUrl ?? s.audioTracks[taskId]?.imageUrl,
              title:
                (status.metadata as any)?.title ?? s.audioTracks[taskId]?.title,
              duration:
                (status.metadata as any)?.duration ?? s.audioTracks[taskId]?.duration,
              progress: status.progress,
              canPlayEarly,
              clips: (status as any).clips ?? [],
            },
          },
        }),
        false,
        'poll/update',
      );

      if (status.status !== 'completed' && status.status !== 'failed') {
        _startPolling(taskId, startTime, attempt + 1, get, set);
      }
    } catch {
      _startPolling(taskId, startTime, attempt + 1, get, set);
    }
  }, randomPollInterval());

  pollingTimers.set(taskId, timer);
}

export type { CreateAudioAction };
