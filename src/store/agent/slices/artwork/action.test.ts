import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generationService } from '@/services/generation';
import { generationTopicService } from '@/services/generationTopic';
import { imageService } from '@/services/image';
import { getAiInfraStoreState } from '@/store/aiInfra';
import { AsyncTaskStatus } from '@/types/asyncTask';

import { useAgentStore } from '../../store';

vi.mock('zustand/traditional');

vi.mock('@/services/generation', () => ({
  generationService: { deleteGeneration: vi.fn(), getGenerationStatus: vi.fn() },
}));

vi.mock('@/services/generationTopic', () => ({
  generationTopicService: { createTopic: vi.fn() },
}));

vi.mock('@/services/image', () => ({
  imageService: { createImage: vi.fn() },
}));

vi.mock('@/store/aiInfra', () => ({
  getAiInfraStoreState: vi.fn(),
}));

const input = {
  description: 'Writes and reviews TypeScript',
  id: 'agent-a',
  kind: 'avatar' as const,
  name: 'Coco',
};

beforeEach(() => {
  vi.clearAllMocks();
  useAgentStore.setState({ agentArtworkGenerationMap: {} });
  vi.mocked(getAiInfraStoreState).mockReturnValue({
    enabledImageModelList: [
      {
        children: [{ abilities: {}, id: 'gpt-image-2' }],
        id: 'openai',
        name: 'OpenAI',
        source: 'builtin',
      },
    ],
  } as ReturnType<typeof getAiInfraStoreState>);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AgentArtworkAction', () => {
  it('keeps a per-agent generating state until the image is saved', async () => {
    let startGeneration: (value: string) => void = () => {};
    vi.mocked(generationTopicService.createTopic).mockReturnValue(
      new Promise((resolve) => {
        startGeneration = resolve;
      }),
    );
    vi.mocked(imageService.createImage).mockResolvedValue({
      data: { generations: [{ asyncTaskId: 'task-1', id: 'generation-1' }] },
      success: true,
    } as never);
    vi.mocked(generationService.getGenerationStatus).mockResolvedValue({
      generation: { asset: { url: 'https://example.com/avatar.webp' } },
      status: AsyncTaskStatus.Success,
    } as never);
    const updateAgentMetaById = vi.fn().mockResolvedValue(undefined);
    useAgentStore.setState({ updateAgentMetaById });

    const promise = useAgentStore.getState().generateAgentArtwork(input);

    expect(useAgentStore.getState().agentArtworkGenerationMap?.['agent-a']).toEqual({
      kind: 'avatar',
      status: 'generating',
    });

    startGeneration('topic-1');
    await promise;

    expect(updateAgentMetaById).toHaveBeenCalledWith('agent-a', {
      avatar: 'https://example.com/avatar.webp',
    });
    expect(useAgentStore.getState().agentArtworkGenerationMap?.['agent-a']).toBeUndefined();
  });

  it('passes the existing avatar as a reference image when generating a background', async () => {
    vi.mocked(getAiInfraStoreState).mockReturnValue({
      enabledImageModelList: [
        {
          children: [
            {
              abilities: {},
              id: 'gpt-image-2',
              parameters: { imageUrls: { default: [], maxCount: 1 }, prompt: { default: '' } },
            },
          ],
          id: 'openai',
          name: 'OpenAI',
          source: 'builtin',
        },
      ],
    } as unknown as ReturnType<typeof getAiInfraStoreState>);
    vi.mocked(generationTopicService.createTopic).mockResolvedValue('topic-1');
    vi.mocked(imageService.createImage).mockResolvedValue({
      data: { generations: [{ asyncTaskId: 'task-1', id: 'generation-1' }] },
      success: true,
    } as never);
    vi.mocked(generationService.getGenerationStatus).mockResolvedValue({
      generation: { asset: { url: 'https://example.com/background.webp' } },
      status: AsyncTaskStatus.Success,
    } as never);
    useAgentStore.setState({ updateAgentMetaById: vi.fn().mockResolvedValue(undefined) });

    await useAgentStore.getState().generateAgentArtwork({
      ...input,
      kind: 'background',
      referenceImageUrl: 'https://example.com/avatar.webp',
    });

    expect(imageService.createImage).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          imageUrls: ['https://example.com/avatar.webp'],
          prompt: expect.stringContaining('attached existing avatar as the visual source of truth'),
        }),
      }),
    );
  });

  it('attaches every style reference when the model has no image input cap', async () => {
    vi.mocked(getAiInfraStoreState).mockReturnValue({
      enabledImageModelList: [
        {
          children: [
            {
              abilities: {},
              id: 'gemini-3.1-flash-lite-image:image',
              parameters: {
                aspectRatio: { default: 'auto', enum: ['auto', '1:1', '16:9'] },
                imageUrls: { default: [] },
                prompt: { default: '' },
              },
            },
          ],
          id: 'google',
          name: 'Google',
          source: 'builtin',
        },
      ],
    } as unknown as ReturnType<typeof getAiInfraStoreState>);
    vi.mocked(generationTopicService.createTopic).mockResolvedValue('topic-1');
    vi.mocked(imageService.createImage).mockResolvedValue({
      data: { generations: [{ asyncTaskId: 'task-1', id: 'generation-1' }] },
      success: true,
    } as never);
    vi.mocked(generationService.getGenerationStatus).mockResolvedValue({
      generation: { asset: { url: 'https://example.com/avatar.webp' } },
      status: AsyncTaskStatus.Success,
    } as never);
    useAgentStore.setState({ updateAgentMetaById: vi.fn().mockResolvedValue(undefined) });

    await useAgentStore.getState().generateAgentArtwork({
      ...input,
      referenceImageUrl: 'https://example.com/background.webp',
      styleReferenceImageUrls: ['https://example.com/ref-a.webp', 'https://example.com/ref-b.webp'],
    });

    expect(imageService.createImage).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          aspectRatio: '1:1',
          imageUrls: ['https://example.com/ref-a.webp', 'https://example.com/ref-b.webp'],
          prompt: expect.stringContaining('as the target character style'),
        }),
      }),
    );
    const { prompt } = vi.mocked(imageService.createImage).mock.calls[0][0].params;
    expect(prompt).not.toContain('attached existing profile background');
  });

  it('truncates style references to the model image input cap', async () => {
    vi.mocked(getAiInfraStoreState).mockReturnValue({
      enabledImageModelList: [
        {
          children: [
            {
              abilities: {},
              id: 'gpt-image-2',
              parameters: { imageUrls: { default: [], maxCount: 1 }, prompt: { default: '' } },
            },
          ],
          id: 'openai',
          name: 'OpenAI',
          source: 'builtin',
        },
      ],
    } as unknown as ReturnType<typeof getAiInfraStoreState>);
    vi.mocked(generationTopicService.createTopic).mockResolvedValue('topic-1');
    vi.mocked(imageService.createImage).mockResolvedValue({
      data: { generations: [{ asyncTaskId: 'task-1', id: 'generation-1' }] },
      success: true,
    } as never);
    vi.mocked(generationService.getGenerationStatus).mockResolvedValue({
      generation: { asset: { url: 'https://example.com/avatar.webp' } },
      status: AsyncTaskStatus.Success,
    } as never);
    useAgentStore.setState({ updateAgentMetaById: vi.fn().mockResolvedValue(undefined) });

    await useAgentStore.getState().generateAgentArtwork({
      ...input,
      styleReferenceImageUrls: ['https://example.com/ref-a.webp', 'https://example.com/ref-b.webp'],
    });

    expect(imageService.createImage).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          imageUrls: ['https://example.com/ref-a.webp'],
          prompt: expect.stringContaining('as the target character style'),
        }),
      }),
    );
  });

  it('keeps a retryable error state when generation cannot start', async () => {
    vi.mocked(generationTopicService.createTopic).mockResolvedValue('topic-1');
    vi.mocked(imageService.createImage).mockResolvedValue({ success: false } as never);

    await expect(useAgentStore.getState().generateAgentArtwork(input)).rejects.toThrow(
      'Image generation could not be started',
    );

    expect(useAgentStore.getState().agentArtworkGenerationMap?.['agent-a']).toEqual({
      error: 'Image generation could not be started',
      kind: 'avatar',
      status: 'error',
    });
  });

  it('cancels polling, deletes the generation, and clears the loading state', async () => {
    vi.mocked(generationTopicService.createTopic).mockResolvedValue('topic-1');
    vi.mocked(imageService.createImage).mockResolvedValue({
      data: { generations: [{ asyncTaskId: 'task-1', id: 'generation-1' }] },
      success: true,
    } as never);
    vi.mocked(generationService.getGenerationStatus).mockResolvedValue({
      status: AsyncTaskStatus.Processing,
    } as never);
    const updateAgentMetaById = vi.fn().mockResolvedValue(undefined);
    useAgentStore.setState({ updateAgentMetaById });

    const promise = useAgentStore.getState().generateAgentArtwork(input);
    await vi.waitFor(() => expect(generationService.getGenerationStatus).toHaveBeenCalled());
    await useAgentStore.getState().cancelAgentArtworkGeneration('agent-a');
    await promise;

    expect(generationService.deleteGeneration).toHaveBeenCalledWith('generation-1');
    expect(updateAgentMetaById).not.toHaveBeenCalled();
    expect(useAgentStore.getState().agentArtworkGenerationMap?.['agent-a']).toBeUndefined();
  });

  it('deletes a generation that starts after cancellation was requested', async () => {
    let finishCreateImage: (value: unknown) => void = () => {};
    vi.mocked(generationTopicService.createTopic).mockResolvedValue('topic-1');
    vi.mocked(imageService.createImage).mockReturnValue(
      new Promise((resolve) => {
        finishCreateImage = resolve;
      }) as never,
    );

    const promise = useAgentStore.getState().generateAgentArtwork(input);
    await vi.waitFor(() => expect(imageService.createImage).toHaveBeenCalled());
    await useAgentStore.getState().cancelAgentArtworkGeneration('agent-a');
    finishCreateImage({
      data: { generations: [{ asyncTaskId: 'task-1', id: 'generation-1' }] },
      success: true,
    });
    await promise;

    expect(generationService.deleteGeneration).toHaveBeenCalledWith('generation-1');
    expect(generationService.getGenerationStatus).not.toHaveBeenCalled();
    expect(useAgentStore.getState().agentArtworkGenerationMap?.['agent-a']).toBeUndefined();
  });
});
