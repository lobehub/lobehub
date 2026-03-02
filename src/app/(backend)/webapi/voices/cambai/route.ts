import { CAMBAI_API_KEY_HEADER_KEY } from '@/const/fetch';

const CAMBAI_VOICES_URL = 'https://client.camb.ai/apis/list-voices';

export const GET = async (req: Request) => {
  const apiKey = req.headers.get(CAMBAI_API_KEY_HEADER_KEY);

  if (!apiKey) {
    return new Response(JSON.stringify({ message: 'CAMB AI API key is required' }), {
      headers: { 'content-type': 'application/json' },
      status: 401,
    });
  }

  const response = await fetch(CAMBAI_VOICES_URL, {
    headers: {
      'x-api-key': apiKey,
    },
    method: 'GET',
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[webapi/voices/cambai] Voice list request failed:', errorText);
    return new Response(JSON.stringify({ error: errorText }), {
      headers: { 'content-type': 'application/json' },
      status: response.status,
    });
  }

  const data = await response.json();
  return new Response(JSON.stringify(data), {
    headers: {
      'Cache-Control': 'max-age=3600',
      'content-type': 'application/json;charset=UTF-8',
    },
  });
};
