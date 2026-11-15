import { lambdaClient } from '@/libs/trpc/client';

export interface TranscribeFileParams {
  fileId: string;
  language?: string;
  model: string;
  provider: string;
}

export interface TranscribeAudioParams {
  /** Base64 audio bytes; short clips only (the router caps inline audio at 3 MB). */
  audioBase64: string;
  fileName: string;
  language?: string;
  mimeType: string;
  model: string;
  provider: string;
}

class AsrService {
  transcribeAudio = (params: TranscribeAudioParams, signal?: AbortSignal) =>
    lambdaClient.asr.transcribe.mutate(params, { signal });

  transcribeFile = (params: TranscribeFileParams, signal?: AbortSignal) =>
    lambdaClient.asr.transcribe.mutate(params, { signal });
}

export const asrService = new AsrService();
