import { type OpenAITTSPayload } from '@lobehub/tts';
import { createOpenaiAudioSpeech } from '@lobehub/tts/server';

import { createBizOpenAI } from '@/app/(backend)/_deprecated/createBizOpenAI';
import { createSpeechResponse } from '@/server/utils/createSpeechResponse';

export const POST = async (req: Request) => {
  const payload = (await req.json()) as OpenAITTSPayload;

  // need to be refactored with jwt auth mode
  const openaiOrErrResponse = createBizOpenAI(req);

  // if resOrOpenAI is a Response, it means there is an error,just return it
  if (openaiOrErrResponse instanceof Response) return openaiOrErrResponse;

  return createSpeechResponse(
    () =>
      createOpenaiAudioSpeech({
        openai: openaiOrErrResponse as any,
        payload,
      }),
    {
      logTag: 'webapi/tts/openai',
      messages: {
        failure: 'Failed to synthesize speech',
        invalid: 'Unexpected payload from OpenAI TTS',
      },
    },
  );
};
