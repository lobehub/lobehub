import { isDesktop } from '@lobechat/const';
import type { FileMetadata } from '@lobechat/types';
import { FileSource, MEETING_ERROR_CODES } from '@lobechat/types';
import { TRPCClientError } from '@trpc/client';

import {
  BrowserAudioWorkletCapture,
  requestDictationMicrophone,
} from '@/features/ChatInput/Dictation/audio';
import { createRealtimeAsrSession } from '@/features/ChatInput/Dictation/service';
import { fileService } from '@/services/file';
import { hashFile } from '@/services/hashFile';
import { meetingService } from '@/services/meeting';
import { uploadService } from '@/services/upload';

import { MeetingRecorder } from './engine/controller';
import type { LiveErrorCode } from './engine/types';
import { LiveTranscriptionError } from './engine/windowTranscriber';

const blobToBase64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x80_00) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x80_00));
  }
  return btoa(binary);
};

const MEETING_ERROR_CODE_SET = new Set<string>(MEETING_ERROR_CODES);

/** Map a `meeting.transcribeLive` failure onto what the live transcriber does next. */
export const toLiveError = (error: unknown): LiveTranscriptionError => {
  if (error instanceof TRPCClientError) {
    const { message } = error;
    const httpCode = (error.data as { code?: string } | undefined)?.code;
    if (httpCode === 'UNAUTHORIZED' || httpCode === 'FORBIDDEN') {
      return new LiveTranscriptionError('auth');
    }
    if (MEETING_ERROR_CODE_SET.has(message)) {
      const code: LiveErrorCode =
        message === 'provider_not_configured' || message === 'quota_exceeded'
          ? message
          : 'provider_unavailable';
      return new LiveTranscriptionError(code);
    }
    // No response at all: the request never reached the server.
    if (!error.data) return new LiveTranscriptionError('network');
  }
  return new LiveTranscriptionError('provider_unavailable');
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

const subscribeOnline = (listener: () => void) => {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('online', listener);
  return () => window.removeEventListener('online', listener);
};

/**
 * The app-wide meeting recorder. A module singleton, so a recording survives
 * route changes and component unmounts.
 */
export const meetingRecorder = new MeetingRecorder({
  api: {
    appendRealtimeSegments: meetingService.appendRealtimeSegments,
    attachAudio: meetingService.attachAudio,
    create: meetingService.create,
    finish: meetingService.finish,
    pause: meetingService.pause,
    refine: meetingService.refine,
    resume: meetingService.resume,
    transcribeWindow: async (meetingId, { wav, ...window }) => {
      try {
        const segment = await meetingService.transcribeLive({
          ...window,
          audioBase64: await blobToBase64(wav),
          meetingId,
        });
        return { text: segment?.text ?? '' };
      } catch (error) {
        throw toLiveError(error);
      }
    },
  },
  createCapture: BrowserAudioWorkletCapture.create,
  createGatewaySession: createRealtimeAsrSession,
  createWebSocket: (url) => new WebSocket(url),
  onOnline: subscribeOnline,
  platform: isDesktop ? 'desktop' : 'web',
  requestMicrophone: requestDictationMicrophone,
  uploadRecording,
});
