export type VoiceMessageUploadError = 'send' | 'unsupported' | 'upload';

export type VoiceMessageUploadStatus = 'failed' | 'sending' | 'uploading';

export interface VoiceMessageUploadState {
  error?: VoiceMessageUploadError;
  progress: number;
  status: VoiceMessageUploadStatus;
}

export interface ChatVoiceMessageState {
  voiceMessageUploadMap: Record<string, VoiceMessageUploadState>;
}

export const initialVoiceMessageState: ChatVoiceMessageState = {
  voiceMessageUploadMap: {},
};
