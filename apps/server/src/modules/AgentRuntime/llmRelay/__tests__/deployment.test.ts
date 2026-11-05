// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isLlmRelayDeploymentReady } from '../deployment';

const env = vi.hoisted(() => ({
  app: {} as Record<string, string | undefined>,
}));

vi.mock('@/envs/app', () => ({ appEnv: env.app }));

// The browser only stands by for a one-shot relay where the server can relay:
// a gateway it can push to. Anything less and the server calls the provider
// itself, which cannot reach a model on the user's device — the browser must
// keep its own fallback then.
describe('isLlmRelayDeploymentReady', () => {
  beforeEach(() => {
    env.app.AGENT_GATEWAY_URL = 'https://gw';
    env.app.AGENT_GATEWAY_INTERNAL_URL = undefined;
    env.app.AGENT_GATEWAY_SERVICE_TOKEN = 'token';
  });

  it('is ready with a gateway and its service token', () => {
    expect(isLlmRelayDeploymentReady()).toBe(true);
  });

  it('is not ready without a gateway service token', () => {
    env.app.AGENT_GATEWAY_SERVICE_TOKEN = undefined;
    expect(isLlmRelayDeploymentReady()).toBe(false);
  });

  it('is not ready without a gateway', () => {
    env.app.AGENT_GATEWAY_URL = undefined;
    expect(isLlmRelayDeploymentReady()).toBe(false);
  });
});
