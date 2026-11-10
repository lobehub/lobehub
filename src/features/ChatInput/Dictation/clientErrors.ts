import { RealtimeDictationError } from './contract';

export const toClientError = (error: unknown): RealtimeDictationError => {
  if (error instanceof RealtimeDictationError) return error;
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return new RealtimeDictationError('MICROPHONE_PERMISSION_DENIED', true);
  }
  if (
    error instanceof Error &&
    (error.message === 'microphone_not_supported' ||
      error.message === 'audio_worklet_not_supported')
  ) {
    return new RealtimeDictationError('MICROPHONE_NOT_SUPPORTED', false);
  }
  if (error instanceof Error && error.message === 'frame_queue_timeout') {
    return new RealtimeDictationError('BACKPRESSURE', true);
  }
  return new RealtimeDictationError('AUDIO_CAPTURE_FAILED', true);
};
