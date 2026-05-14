import { createHeaderWithOpenAI } from './_header';
import { API_ENDPOINTS } from './_url';

interface CreateOpenAIRealtimeCallParams {
  model: string;
  sdp: string;
  voice?: string;
}

export const voiceService = {
  createOpenAIRealtimeCall: async ({ model, sdp, voice }: CreateOpenAIRealtimeCallParams) => {
    const headers = new Headers(createHeaderWithOpenAI({ 'content-type': 'application/sdp' }));
    if (voice) headers.set('x-openai-realtime-voice', voice);

    const response = await fetch(API_ENDPOINTS.openAIRealtimeCall(model), {
      body: sdp,
      headers,
      method: 'POST',
    });

    const body = await response.text();

    if (!response.ok) {
      throw new Error(body || response.statusText);
    }

    return body;
  },
};
