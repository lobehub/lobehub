import {
  conversationConfigSchema,
  type SpeechRequest,
  type SpeechResponse,
} from '@lobechat/livekit-bridge';

import { lambdaClient } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

/** Reuses authenticated provider routes; no provider credentials enter a LiveKit room. */
export const handleConversationSpeech = async (
  request: SpeechRequest,
  signal: AbortSignal,
): Promise<SpeechResponse> => {
  const state = useUserStore.getState();
  const config = conversationConfigSchema.parse(
    settingsSelectors.currentSettings(state).general?.conversation ?? {},
  );
  if (!config.enabled) throw new Error('Conversations are disabled');
  if (request.kind === 'asr') {
    const ref = settingsSelectors.currentSystemAgent(state).asr;
    const result = await lambdaClient.asr.transcribe.mutate(
      {
        audioBase64: request.audioBase64,
        fileName: 'conversation.wav',
        mimeType: 'audio/wav',
        model: ref.model,
        provider: ref.provider,
        language: config.language,
      },
      { signal },
    );
    return { requestId: request.requestId, ok: true, text: result.text };
  }
  const result = await lambdaClient.tts.synthesize.mutate(
    {
      input: request.text,
      ...config.tts,
      voice: config.voice || undefined,
    },
    { signal },
  );
  if (result.format !== 'mp3' && result.format !== 'opus' && result.format !== 'aac')
    throw new Error('Unsupported speech format');
  return {
    requestId: request.requestId,
    ok: true,
    audioBase64: result.audioBase64,
    format: result.format,
  };
};
