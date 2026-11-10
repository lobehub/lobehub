import { isDesktop } from '@lobechat/const';
import type { FileMetadata } from '@lobechat/types';
import { FileSource } from '@lobechat/types';

import { BrowserAudioWorkletCapture } from '@/features/ChatInput/Dictation/audio';
import { REALTIME_ASR_AUDIO } from '@/features/ChatInput/Dictation/contract';
import { asrService } from '@/services/asr';
import { fileService } from '@/services/file';
import { hashFile } from '@/services/hashFile';
import { meetingService } from '@/services/meeting';
import { uploadService } from '@/services/upload';
import { meetingActions, useMeetingStore } from '@/store/meeting';
import { getUserStoreState } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/selectors';

import { type AudioRecorder, MeetingRecorderController } from './engine/controller';
import { isNetworkError } from './engine/networkError';
import { blobToBase64, encodeWav } from './engine/wav';
import { createLocalMeetingSession } from './localSession';

const PREFERRED_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

const getUserMedia = (deviceId?: string) => {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new Error('microphone_not_supported'));
  }

  return navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: { ideal: 1 },
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });
};

const createAudioRecorder = (stream: MediaStream): AudioRecorder => {
  const mimeType = PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });

  return {
    pause: () => {
      if (recorder.state === 'recording') recorder.pause();
    },
    resume: () => {
      if (recorder.state === 'paused') recorder.resume();
    },
    // A timeslice keeps the recording in memory as it grows, so a crash in the
    // last minute does not lose the whole chunk.
    start: () => recorder.start(1000),
    stop: () =>
      new Promise<Blob>((resolve) => {
        const finish = () => resolve(new Blob(chunks, { type: recorder.mimeType || mimeType }));
        if (recorder.state === 'inactive') return finish();
        recorder.addEventListener('stop', finish, { once: true });
        recorder.stop();
      }),
  };
};

const uploadRecording = async (file: File) => {
  const hash = await hashFile(file);
  const { data } = await uploadService.uploadFileToS3(file, { skipCheckFileType: true });
  const metadata: FileMetadata = data;
  const created = await fileService.createFile({
    fileType: file.type,
    hash,
    metadata,
    name: file.name,
    size: file.size,
    source: FileSource.Meeting,
    url: data.path,
  });
  return created.id;
};

const liveTranscribe = () => {
  const { model, provider } = systemAgentSelectors.asr(getUserStoreState());
  if (!model || !provider) return undefined;

  return async ({ frames }: { frames: ArrayBuffer[] }) => {
    const wav = encodeWav(frames, REALTIME_ASR_AUDIO.sampleRate);
    const { text } = await asrService.transcribeAudio({
      audioBase64: await blobToBase64(wav),
      fileName: 'live.wav',
      mimeType: 'audio/wav',
      model,
      provider,
    });
    return text;
  };
};

/**
 * The app-wide meeting recorder. A module singleton, so a recording survives
 * route changes and component unmounts.
 */
export const meetingRecorder = new MeetingRecorderController({
  api: {
    appendRealtimeSegments: meetingService.appendRealtimeSegments,
    attachAudio: meetingService.attachAudio,
    attachLocalAudio: meetingService.attachLocalAudio,
    completeLocalRefine: meetingService.completeLocalRefine,
    create: meetingService.create,
    failLocalRefine: meetingService.failLocalRefine,
    finish: meetingService.finish,
    pause: meetingService.pause,
    refine: meetingService.refine,
    resume: meetingService.resume,
    startLocalRefine: meetingService.startLocalRefine,
  },
  createAudioRecorder,
  createCapture: BrowserAudioWorkletCapture.create,
  createLocalSession: createLocalMeetingSession,
  frameMs: REALTIME_ASR_AUDIO.frameDurationMs,
  getUserMedia,
  liveTranscribe,
  network: {
    isNetworkError,
    isOnline: () => typeof navigator === 'undefined' || navigator.onLine,
    waitOnline: (timeoutMs) =>
      new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          window.removeEventListener('online', done);
          resolve();
        };
        const timer = setTimeout(done, timeoutMs);
        window.addEventListener('online', done);
      }),
  },
  platform: isDesktop ? 'desktop' : 'web',
  refreshMeetings: () => {
    void meetingActions.refreshMeetings().catch(() => undefined);
  },
  store: {
    getRecorder: () => useMeetingStore.getState().recorder,
    getSelectedDeviceId: () => useMeetingStore.getState().selectedDeviceId,
    patchRecorder: meetingActions.patchRecorder,
    setDevices: meetingActions.setDevices,
    setPermission: meetingActions.setPermission,
  },
  uploadRecording,
});

export const listMicrophones = () =>
  meetingRecorder.refreshDevices(() =>
    typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices
      ? navigator.mediaDevices.enumerateDevices()
      : Promise.resolve([]),
  );

/** Read the microphone permission without prompting, and follow its changes. */
export const watchMicrophonePermission = () => {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return () => undefined;

  let status: PermissionStatus | undefined;
  let disposed = false;
  const apply = () => {
    if (!status) return;
    meetingActions.setPermission(status.state);
    // Labels and the full device list only appear once access is granted.
    if (status.state === 'granted') void listMicrophones();
  };

  navigator.permissions
    .query({ name: 'microphone' as PermissionName })
    .then((result) => {
      if (disposed) return;
      status = result;
      apply();
      status.addEventListener('change', apply);
    })
    .catch(() => undefined);

  return () => {
    disposed = true;
    status?.removeEventListener('change', apply);
  };
};
