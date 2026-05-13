import type {
  EdgeSpeechPayload,
  MicrosoftSpeechPayload,
  OpenAISTTPayload,
  OpenAITTSPayload,
} from '@lobehub/tts';
import { EdgeSpeechTTS, MicrosoftSpeechTTS } from '@lobehub/tts';
import { createOpenaiAudioSpeech, createOpenaiAudioTranscriptions } from '@lobehub/tts/server';

import { createBizOpenAI } from '@/app/(backend)/_deprecated/createBizOpenAI';
import { createSpeechResponse } from '@/server/utils/createSpeechResponse';

type OpenAITTSClient = Parameters<typeof createOpenaiAudioSpeech>[0]['openai'];
type OpenAISTTClient = Parameters<typeof createOpenaiAudioTranscriptions>[0]['openai'];

export const edgeTTSAPIHandler = async (request: Request): Promise<Response> => {
  const payload = (await request.json()) as EdgeSpeechPayload;

  return createSpeechResponse(() => EdgeSpeechTTS.createRequest({ payload }), {
    logTag: 'webapi/tts/edge',
    messages: {
      failure: 'Failed to synthesize speech',
      invalid: 'Unexpected payload from Edge speech API',
    },
  });
};

export const microsoftTTSAPIHandler = async (request: Request): Promise<Response> => {
  const payload = (await request.json()) as MicrosoftSpeechPayload;

  return createSpeechResponse(() => MicrosoftSpeechTTS.createRequest({ payload }), {
    logTag: 'webapi/tts/microsoft',
    messages: {
      failure: 'Failed to synthesize speech',
      invalid: 'Unexpected payload from Microsoft speech API',
    },
  });
};

export const openAITTSAPIHandler = async (request: Request): Promise<Response> => {
  const payload = (await request.json()) as OpenAITTSPayload;

  const openaiOrErrResponse = createBizOpenAI(request);

  if (openaiOrErrResponse instanceof Response) return openaiOrErrResponse;

  return createSpeechResponse(
    () =>
      createOpenaiAudioSpeech({
        openai: openaiOrErrResponse as unknown as OpenAITTSClient,
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

export const openAISTTAPIHandler = async (request: Request): Promise<Response> => {
  const formData = await request.formData();
  const speechBlob = formData.get('speech') as Blob;
  const optionsString = formData.get('options') as string;
  const payload = {
    options: JSON.parse(optionsString),
    speech: speechBlob,
  } as OpenAISTTPayload;

  const openaiOrErrResponse = createBizOpenAI(request);

  if (openaiOrErrResponse instanceof Response) return openaiOrErrResponse;

  const response = await createOpenaiAudioTranscriptions({
    openai: openaiOrErrResponse as unknown as OpenAISTTClient,
    payload,
  });

  return new Response(JSON.stringify(response), {
    headers: {
      'content-type': 'application/json;charset=UTF-8',
    },
  });
};
