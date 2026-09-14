// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { createProductionRewriteGenerator } from './productionGenerator';

const mocks = vi.hoisted(() => ({
  generateBlockImageRewrite: vi.fn(),
  messageModel: {
    update: vi.fn(),
  },
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(function () {
    return mocks.messageModel;
  }),
}));
vi.mock('./imageGenerator', () => ({
  BLOCK_IMAGE_REWRITE_ADAPTER_ID: 'block-image',
  BlockImageRewriteError: class BlockImageRewriteError extends Error {},
  generateBlockImageRewrite: mocks.generateBlockImageRewrite,
  normalizeBlockImageModel: (model: string, provider: string) =>
    provider === 'zenmux' && model === 'gpt-image-2' ? 'openai/gpt-image-2' : model,
}));

class ReceiverSensitiveRuntime {
  marker = 'runtime';

  createImage() {
    if (this.marker !== 'runtime') throw new Error('lost runtime receiver');
    return Promise.resolve({ imageUrl: 'data:image/png;base64,AAAA' });
  }
}

describe('production block-image runtime binding', () => {
  it('keeps the ModelRuntime receiver when handing image generation to the helper', async () => {
    const runtime = new ReceiverSensitiveRuntime();
    let helperOptions: { model?: string } | undefined;
    mocks.generateBlockImageRewrite.mockImplementationOnce(async (_input, options) => {
      helperOptions = options;
      await options.runtime.createImage(
        { model: 'openai/gpt-image-2', params: { prompt: 'a mountain' } },
        { signal: new AbortController().signal },
      );
      return {
        replacementBlock: { kind: 'patch', patch: { src: '/f/generated' } },
      };
    });

    const generator = createProductionRewriteGenerator(
      {
        agentServiceFactory: async () => ({
          getAgentConfigById: async () => ({ model: 'gpt-image-2', provider: 'zenmux' }),
        }),
        db: {} as never,
        modelRuntimeFactory: async () => runtime as never,
      },
      { agentId: 'agent-1', db: {} as never, requestedByUserId: 'user-1', workspaceId: null },
    );

    await expect(
      generator.generate!({
        adapterId: 'block-image',
        agentId: 'agent-1',
        attempt: 1,
        assistantMessageId: 'assistant-1',
        blockImage: {
          altText: '',
          height: null,
          maxWidth: null,
          placeholder: true,
          src: '',
          status: 'loading',
          width: null,
        },
        documentId: 'document-1',
        instruction: 'a mountain',
        nodeType: 'block-image',
        outputSchema: 'patch',
        quotedText: '{}',
        requestId: 'request-1',
        signal: new AbortController().signal,
        sourceHash: 'fnv1a-source',
        targetKind: 'node',
        targetNodeId: 'image-1',
        targetNodeIds: ['image-1'],
        topicId: 'topic-1',
      }),
    ).resolves.toMatchObject({ replacementBlock: { kind: 'patch' } });
    expect(helperOptions?.model).toBe('openai/gpt-image-2');
    expect(mocks.messageModel.update).toHaveBeenCalledWith(
      'assistant-1',
      expect.objectContaining({ content: '![Generated image](/f/generated)' }),
    );
  });
});
