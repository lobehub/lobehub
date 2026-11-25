import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveModelContext } from './modelFacts';
import type { ToolDiscoveryDeps } from './types';

describe('resolveModelContext', () => {
  const deps = {
    db: {} as ToolDiscoveryDeps['db'],
    userId: 'user_1',
    workspaceId: undefined,
  } as ToolDiscoveryDeps;

  const baseCtx = {
    agentConfig: { chatConfig: {}, id: 'agent_1' },
    model: 'custom-vlm',
    provider: 'openai',
    topicId: undefined,
  };

  const makeMetadataTask = (modelRow: unknown = undefined, providerRow: unknown = undefined) =>
    Promise.resolve([
      { status: 'fulfilled' as const, value: modelRow },
      { status: 'fulfilled' as const, value: providerRow },
    ] as any);

  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('honors env *_MODEL_LIST media abilities for custom models absent from model-bank and DB', async () => {
    vi.stubEnv(
      'OPENAI_MODEL_LIST',
      '-all,+custom-vlm=Custom VLM<262144:vision:video:reasoning:fc>',
    );

    const result = await resolveModelContext(deps, baseCtx, [], makeMetadataTask());

    expect(result.modelMediaCapabilities).toMatchObject({
      video: true,
      vision: true,
    });
    expect(result.modelFacts.mediaCapabilities).toMatchObject({
      video: true,
      vision: true,
    });
  });

  it('prefers explicit DB user abilities over env *_MODEL_LIST abilities', async () => {
    vi.stubEnv('OPENAI_MODEL_LIST', '-all,+custom-vlm=Custom VLM<262144:vision:video>');

    const result = await resolveModelContext(
      deps,
      baseCtx,
      [],
      makeMetadataTask({ abilities: { vision: false } }),
    );

    expect(result.modelMediaCapabilities).toEqual({
      audio: false,
      video: false,
      vision: false,
    });
  });

  it('honors provider-specific MODEL_LIST env keys such as AWS_BEDROCK_MODEL_LIST', async () => {
    vi.stubEnv('AWS_BEDROCK_MODEL_LIST', '-all,+custom-bedrock-vlm=Bedrock VLM<128000:vision>');

    const result = await resolveModelContext(
      deps,
      { ...baseCtx, model: 'custom-bedrock-vlm', provider: 'bedrock' },
      [],
      makeMetadataTask(),
    );

    expect(result.modelMediaCapabilities).toMatchObject({ vision: true });
  });

  it('does not throw for custom user-created provider ids outside ModelProvider enum', async () => {
    const result = await resolveModelContext(
      deps,
      { ...baseCtx, model: 'local-vlm', provider: 'my-custom-provider' },
      [],
      makeMetadataTask(),
    );

    expect(result.modelMediaCapabilities).toEqual({});
  });
});
