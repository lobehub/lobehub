import { CAMBAI_API_KEY_HEADER_KEY } from '@/const/fetch';

const CAMBAI_TTS_URL = 'https://client.camb.ai/apis/tts-stream';

export const POST = async (req: Request) => {
  const apiKey = req.headers.get(CAMBAI_API_KEY_HEADER_KEY);

  if (!apiKey) {
    return new Response(JSON.stringify({ message: 'CAMB AI API key is required' }), {
      headers: { 'content-type': 'application/json' },
      status: 401,
    });
  }

  const payload = await req.json();

  const response = await fetch(CAMBAI_TTS_URL, {
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    method: 'POST',
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[webapi/tts/cambai] TTS request failed:', errorText);
    return new Response(JSON.stringify({ error: errorText }), {
      headers: { 'content-type': 'application/json' },
      status: response.status,
    });
  }

  return new Response(response.body, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': response.headers.get('Content-Type') || 'audio/mpeg',
    },
  });
};
