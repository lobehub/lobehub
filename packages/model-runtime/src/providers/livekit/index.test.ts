// @vitest-environment node
import { jwtVerify } from 'jose';
import { describe, expect, it, vi } from 'vitest';

import { createLiveKitInferenceToken } from './auth';
import { LobeLiveKitAI } from './index';

const credentials = { apiKey: 'project-key', apiSecret: 'project-secret' };

describe('LiveKit inference authentication', () => {
  it.each([{}, { apiKey: 'key' }, { apiSecret: 'secret' }, { apiKey: ' ', apiSecret: ' ' }])(
    'requires the complete project credential pair',
    (options) => {
      expect(() => new LobeLiveKitAI(options)).toThrow();
    },
  );

  it('creates a short-lived inference-only JWT matching the Agents SDK grant', async () => {
    const token = await createLiveKitInferenceToken(credentials.apiKey, credentials.apiSecret);
    const { payload, protectedHeader } = await jwtVerify(
      token,
      new TextEncoder().encode(credentials.apiSecret),
      { issuer: credentials.apiKey },
    );
    expect(protectedHeader.alg).toBe('HS256');
    expect(payload).toMatchObject({ inference: { perform: true }, sub: 'agent' });
    expect(payload.exp! - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(600);
    expect(payload.video).toBeUndefined();
  });

  it('uses gateway chat completions with a signed bearer token rather than raw project credentials', async () => {
    const upstream = vi.fn(async (_url, init) => {
      const authorization = new Headers(init.headers).get('Authorization')!;
      const { payload } = await jwtVerify(
        authorization.slice(7),
        new TextEncoder().encode(credentials.apiSecret),
      );
      expect(payload.iss).toBe(credentials.apiKey);
      expect(JSON.stringify(init)).not.toContain(credentials.apiSecret);
      return new Response(
        JSON.stringify({
          id: 'chat',
          object: 'chat.completion',
          created: 1,
          model: 'google/gemma-4-31b-it',
          choices: [
            { index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' },
          ],
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    });
    const runtime = new LobeLiveKitAI({ ...credentials, fetch: upstream });
    await runtime.chat({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'google/gemma-4-31b-it',
      stream: false,
    });
    expect(upstream.mock.calls[0][0]).toContain('agent-gateway.livekit.cloud/v1/chat/completions');
  });

  it('returns the built-in catalog without upstream discovery', async () => {
    const upstream = vi.fn();
    const runtime = new LobeLiveKitAI({ ...credentials, fetch: upstream });
    expect(await runtime.models()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'google/gemma-4-31b-it' })]),
    );
    expect(upstream).not.toHaveBeenCalled();
  });
  it('uses signed chat completions for streaming requests even with a Responses preference', async () => {
    const upstream = vi.fn(
      async () =>
        new Response(
          'data: {"id":"chat","object":"chat.completion.chunk","created":1,"model":"google/gemma-4-31b-it","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}\n\ndata: [DONE]\n\n',
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
    );
    const runtime = new LobeLiveKitAI({ ...credentials, fetch: upstream });
    const response = await runtime.chat({
      apiMode: 'responses',
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'google/gemma-4-31b-it',
      stream: true,
    });
    expect(await response.text()).toContain('Hello');
    expect(upstream.mock.calls[0][0]).toContain('/chat/completions');
    const token = new Headers(upstream.mock.calls[0][1].headers).get('Authorization')!.slice(7);
    expect(
      (await jwtVerify(token, new TextEncoder().encode(credentials.apiSecret))).payload.inference,
    ).toEqual({ perform: true });
  });

  it('maps gateway authorization rejection to the provider credential error', async () => {
    const upstream = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'Invalid token' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const runtime = new LobeLiveKitAI({ ...credentials, fetch: upstream, maxRetries: 0 });
    await expect(
      runtime.chat({ messages: [], model: 'google/gemma-4-31b-it', stream: false }),
    ).rejects.toMatchObject({ errorType: 'InvalidProviderAPIKey' });
  });
});
