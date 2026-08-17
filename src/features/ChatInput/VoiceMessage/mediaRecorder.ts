export const VOICE_MESSAGE_MIN_DURATION_MS = 600;
export const VOICE_MESSAGE_MAX_DURATION_MS = 60_000;

export const RECORDING_MIME_TYPE_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
] as const;

type MediaRecorderSupport = Pick<typeof MediaRecorder, 'isTypeSupported'>;

export const selectRecordingMimeType = (
  mediaRecorder: MediaRecorderSupport,
): string | undefined => {
  for (const mimeType of RECORDING_MIME_TYPE_CANDIDATES) {
    if (mediaRecorder.isTypeSupported(mimeType)) return mimeType;
  }

  return undefined;
};

export const resolveRecordingMimeType = (
  recorderMimeType: string,
  chunks: Blob[],
  requestedMimeType?: string,
): string => {
  return (
    recorderMimeType ||
    chunks.find((chunk) => Boolean(chunk.type))?.type ||
    requestedMimeType ||
    'audio/webm'
  );
};

export const getAudioCodec = (mimeType: string): string | undefined => {
  const codec = /codecs\s*=\s*"?([^";,]+)"?/i.exec(mimeType)?.[1]?.trim();
  return codec || undefined;
};

export const getAudioFileExtension = (mimeType: string): string => {
  const container = mimeType.split(';')[0]?.trim().toLowerCase();

  switch (container) {
    case 'audio/mp4':
    case 'audio/aac': {
      return 'm4a';
    }
    case 'audio/ogg': {
      return 'ogg';
    }
    case 'audio/wav':
    case 'audio/x-wav': {
      return 'wav';
    }
    case 'audio/mpeg': {
      return 'mp3';
    }
    default: {
      return 'webm';
    }
  }
};

export const formatVoiceDuration = (durationMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export type VoiceRecorderErrorCode = 'not_supported' | 'permission_denied' | 'recording_failed';

export const getVoiceRecorderErrorCode = (error: unknown): VoiceRecorderErrorCode => {
  const name =
    error && typeof error === 'object' && 'name' in error
      ? (error as { name?: unknown }).name
      : undefined;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'permission_denied';
  }

  return 'recording_failed';
};
