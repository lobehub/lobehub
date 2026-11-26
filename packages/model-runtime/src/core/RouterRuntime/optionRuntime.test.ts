import { describe, expect, it, vi } from 'vitest';

import type { LobeGoogleAI } from '../../providers/google';
import { LobeVertexAI } from '../../providers/vertexai';
import { createRuntimeFromOption } from './optionRuntime';
import type { RouterRuntimeDeps } from './routeSelection';

const createDeps = (id: string): RouterRuntimeDeps => ({
  id,
  options: {},
  params: {},
  routers: [],
  trace: vi.fn() as unknown as RouterRuntimeDeps['trace'],
});

describe('createRuntimeFromOption', () => {
  it('prices Vertex AI channels with the router provider id, like other channels', async () => {
    const credentials = JSON.stringify({
      client_email: 'probe@example.iam.gserviceaccount.com',
      private_key: 'key',
      type: 'service_account',
    });

    const { runtime } = await createRuntimeFromOption(
      createDeps('lobehub'),
      { apiType: 'google', id: 'gemini', options: [] },
      { apiKey: credentials, apiType: 'vertexai', id: 'vertexai', project: 'project' },
    );
    const { runtime: googleRuntime } = await createRuntimeFromOption(
      createDeps('lobehub'),
      { apiType: 'google', id: 'gemini', options: [] },
      { apiKey: 'google-key', apiType: 'google', id: 'google' },
    );

    // `provider` selects the pricing card in getModelPricing, so a Vertex channel must not fall
    // back to the static `vertexai` card (official price) while other channels use the router's.
    expect((runtime as LobeGoogleAI).provider).toBe('lobehub');
    expect((googleRuntime as LobeGoogleAI).provider).toBe('lobehub');
  });

  it('keeps the vertexai provider id for standalone Vertex AI runtimes', () => {
    const runtime = LobeVertexAI.initFromVertexAI({ project: 'project' });

    expect(runtime.provider).toBe('vertexai');
  });
});
