import { type MicrosoftSpeechPayload } from '@lobehub/tts';
import { MicrosoftSpeechTTS } from '@lobehub/tts';

import { createSpeechResponse } from '@/server/utils/createSpeechResponse';

export const POST = async (req: Request) => {
  const payload = (await req.json()) as MicrosoftSpeechPayload;

  return createSpeechResponse(() => MicrosoftSpeechTTS.createRequest({ payload }), {
    logTag: 'webapi/tts/microsoft',
    messages: {
      failure: 'Failed to synthesize speech',
      invalid: 'Unexpected payload from Microsoft speech API',
    },
  });
};
