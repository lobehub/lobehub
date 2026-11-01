import { lambdaClient } from '@/libs/trpc/client';

export interface TranscribeFileParams {
  fileId: string;
  language?: string;
  model: string;
  provider: string;
}

class AsrService {
  transcribeFile = (params: TranscribeFileParams, signal?: AbortSignal) =>
    lambdaClient.asr.transcribe.mutate(params, { signal });
}

export const asrService = new AsrService();
