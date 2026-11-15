// @vitest-environment node
import { LobeLiveKitAI } from '@lobechat/model-runtime';
import { ModelProvider } from 'model-bank';
import { expect, it, vi } from 'vitest';

import { buildPayloadFromKeyVaults, initModelRuntimeWithUserPayload } from './index';

vi.mock('@/server/globalConfig', () => ({ getServerAiProviderConfig: vi.fn() }));
vi.mock('@/envs/llm', () => ({
  getLLMConfig: () => ({
    LIVEKIT_INFERENCE_API_KEY: 'server-key',
    LIVEKIT_INFERENCE_API_SECRET: 'server-secret',
  }),
}));

it('forwards both encrypted vault fields into the builtin runtime', () => {
  const payload = buildPayloadFromKeyVaults(
    { apiKey: 'user-key', apiSecret: 'user-secret' },
    ModelProvider.LiveKit,
  );
  expect(payload).toMatchObject({
    apiKey: 'user-key',
    apiSecret: 'user-secret',
    runtimeProvider: 'livekit',
  });
  expect(
    initModelRuntimeWithUserPayload(ModelProvider.LiveKit, payload)['_runtime'],
  ).toBeInstanceOf(LobeLiveKitAI);
});

it('uses the deployment pair only when no user credentials are supplied', () => {
  expect(() => initModelRuntimeWithUserPayload(ModelProvider.LiveKit, {})).not.toThrow();
  expect(() =>
    initModelRuntimeWithUserPayload(ModelProvider.LiveKit, { apiKey: 'user-key' }),
  ).toThrow();
  expect(() =>
    initModelRuntimeWithUserPayload(ModelProvider.LiveKit, { apiSecret: 'user-secret' }),
  ).toThrow();
});

it('does not expose deployment credentials to a custom runtime or endpoint', () => {
  expect(() =>
    initModelRuntimeWithUserPayload('custom-livekit', { runtimeProvider: 'livekit' }),
  ).toThrow();
  expect(() =>
    initModelRuntimeWithUserPayload(ModelProvider.LiveKit, { baseURL: 'https://other.example/v1' }),
  ).toThrow();
});
