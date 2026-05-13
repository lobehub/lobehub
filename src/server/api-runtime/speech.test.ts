// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as openAISTTPost } from '@/app/(backend)/webapi/stt/openai/route';
import { POST as edgePost } from '@/app/(backend)/webapi/tts/edge/route';
import { POST as microsoftPost } from '@/app/(backend)/webapi/tts/microsoft/route';
import { POST as openAIPost } from '@/app/(backend)/webapi/tts/openai/route';
import honoApp from '@/server/hono';

const { createSpeechResponseMock } = vi.hoisted(() => ({
  createSpeechResponseMock: vi.fn(),
}));

vi.mock('@lobehub/tts', () => ({
  EdgeSpeechTTS: {
    createRequest: vi.fn(),
  },
  MicrosoftSpeechTTS: {
    createRequest: vi.fn(),
  },
}));

vi.mock('@lobehub/tts/server', () => ({
  createOpenaiAudioSpeech: vi.fn(),
  createOpenaiAudioTranscriptions: vi.fn(async () => ({ text: 'hello' })),
}));

vi.mock('@/app/(backend)/_deprecated/createBizOpenAI', () => ({
  createBizOpenAI: vi.fn(() => ({})),
}));

vi.mock('@/server/utils/createSpeechResponse', () => ({
  createSpeechResponse: createSpeechResponseMock,
}));

const createRequest = (path: string, headers?: HeadersInit) =>
  new Request(`https://example.com${path}`, {
    body: JSON.stringify({ input: 'hello' }),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    method: 'POST',
  });

const expectSpeechResponse = async (response: Response, runtime?: string) => {
  expect(response.status).toBe(201);
  if (runtime) {
    expect(response.headers.get('x-lobe-api-runtime')).toBe(runtime);
  }
  expect(await response.text()).toBe('audio');
};

const createSTTRequest = (headers?: HeadersInit) => {
  const formData = new FormData();
  formData.set('speech', new Blob(['audio']));
  formData.set('options', JSON.stringify({ model: 'whisper-1' }));

  return new Request('https://example.com/webapi/stt/openai', {
    body: formData,
    headers,
    method: 'POST',
  });
};

const expectSTTResponse = async (response: Response, runtime?: string) => {
  expect(response.status).toBe(200);
  if (runtime) {
    expect(response.headers.get('x-lobe-api-runtime')).toBe(runtime);
  }
  expect(response.headers.get('content-type')).toBe('application/json;charset=UTF-8');
  expect(await response.json()).toEqual({ text: 'hello' });
};

beforeEach(() => {
  vi.clearAllMocks();
  createSpeechResponseMock.mockResolvedValue(new Response('audio', { status: 201 }));
});

describe('/webapi/tts/edge runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await edgePost(createRequest('/webapi/tts/edge'));

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectSpeechResponse(response, 'next');
  });

  it('returns the same response through the Hono gray-release path', async () => {
    const response = await edgePost(
      createRequest('/webapi/tts/edge', { 'x-lobe-api-runtime': 'hono' }),
    );

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectSpeechResponse(response, 'hono');
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createRequest('/webapi/tts/edge'));

    await expectSpeechResponse(response);
  });
});

describe('/webapi/tts/microsoft runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await microsoftPost(createRequest('/webapi/tts/microsoft'));

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectSpeechResponse(response, 'next');
  });

  it('returns the same response through the Hono gray-release path', async () => {
    const response = await microsoftPost(
      createRequest('/webapi/tts/microsoft', { 'x-lobe-api-runtime': 'hono' }),
    );

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectSpeechResponse(response, 'hono');
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createRequest('/webapi/tts/microsoft'));

    await expectSpeechResponse(response);
  });
});

describe('/webapi/tts/openai runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await openAIPost(createRequest('/webapi/tts/openai'));

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectSpeechResponse(response, 'next');
  });

  it('returns the same response through the Hono gray-release path', async () => {
    const response = await openAIPost(
      createRequest('/webapi/tts/openai', { 'x-lobe-api-runtime': 'hono' }),
    );

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectSpeechResponse(response, 'hono');
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createRequest('/webapi/tts/openai'));

    await expectSpeechResponse(response);
  });
});

describe('/webapi/stt/openai runtime parity', () => {
  it('keeps the Next.js route as the default path', async () => {
    const response = await openAISTTPost(createSTTRequest());

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('default');
    await expectSTTResponse(response, 'next');
  });

  it('returns the same response through the Hono gray-release path', async () => {
    const response = await openAISTTPost(createSTTRequest({ 'x-lobe-api-runtime': 'hono' }));

    expect(response.headers.get('x-lobe-api-runtime-reason')).toBe('request-header');
    await expectSTTResponse(response, 'hono');
  });

  it('can be served by the root Hono runtime app', async () => {
    const response = await honoApp.fetch(createSTTRequest());

    await expectSTTResponse(response);
  });
});
