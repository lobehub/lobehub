import { ChatErrorType } from '@lobechat/types';

import { getOpenAIAuthFromRequest } from '@/const/fetch';
import { getLLMConfig } from '@/envs/llm';
import { createErrorResponse } from '@/utils/errorResponse';

const OPENAI_REALTIME_CALLS_PATH = '/v1/realtime/calls';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com';

const normalizeOpenAIBaseURL = (baseURL?: string | null) => {
  const normalized = (baseURL || process.env.OPENAI_PROXY_URL || DEFAULT_OPENAI_BASE_URL).replace(
    /\/$/,
    '',
  );

  return normalized.replace(/\/v1$/i, '');
};

const readRealtimeError = async (response: Response) => {
  const body = await response.text();

  try {
    const payload = JSON.parse(body) as { error?: { message?: string } | string };
    if (typeof payload.error === 'string') return payload.error;
    if (payload.error?.message) return payload.error.message;
  } catch (error) {
    console.error('[webapi/voice/realtime/openai] failed to parse error body', error);
  }

  return body || response.statusText;
};

export const POST = async (req: Request) => {
  const { apiKey: userApiKey, endpoint } = getOpenAIAuthFromRequest(req);
  const { OPENAI_API_KEY } = getLLMConfig();
  const apiKey = userApiKey || OPENAI_API_KEY;

  if (!apiKey) return createErrorResponse(ChatErrorType.NoOpenAIAPIKey);

  const model = new URL(req.url).searchParams.get('model') || 'gpt-realtime';
  const voice = req.headers.get('x-openai-realtime-voice') || 'alloy';
  const sdp = await req.text();

  if (!sdp.trim()) {
    return new Response('SDP offer is required', { status: 400 });
  }

  const formData = new FormData();
  formData.set('sdp', sdp);
  formData.set(
    'session',
    JSON.stringify({
      audio: {
        output: { voice },
      },
      model,
      type: 'realtime',
    }),
  );

  const response = await fetch(`${normalizeOpenAIBaseURL(endpoint)}${OPENAI_REALTIME_CALLS_PATH}`, {
    body: formData,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    method: 'POST',
  });

  if (!response.ok) {
    return new Response(await readRealtimeError(response), { status: response.status });
  }

  return new Response(await response.text(), {
    headers: { 'content-type': 'application/sdp' },
  });
};
