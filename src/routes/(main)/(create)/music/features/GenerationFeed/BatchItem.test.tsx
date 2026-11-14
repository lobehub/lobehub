import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AsyncTaskErrorType, AsyncTaskStatus } from '@/types/asyncTask';
import type { Generation, GenerationBatch } from '@/types/generation';

import { MusicGenerationBatchItem } from './BatchItem';

const recreateMusic = vi.fn();
const navigate = vi.fn();

const musicState = {
  activeGenerationTopicId: 'topic-1',
  recreateMusic,
  removeGeneration: vi.fn(),
  removeGenerationBatch: vi.fn(),
  retryingBatchIds: [] as string[],
  reuseMusicSettings: vi.fn(),
  useCheckGenerationStatus: vi.fn(),
};

vi.mock('@/store/music', () => ({
  useMusicStore: (selector: (state: typeof musicState) => unknown) => selector(musicState),
}));

vi.mock('@/store/aiInfra', () => ({
  aiProviderSelectors: { enabledMusicModelList: () => [] },
  useAiInfraStore: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => undefined,
}));

vi.mock('@/components/LobeIcons', () => ({ ModelIcon: () => null }));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigate,
}));

// The shared banner image and video use; the music feed must not fall back to it
vi.mock('@/routes/(main)/(create)/features/GenerationInput', () => ({
  GenerationInvalidAPIKey: () => <div data-testid="invalid-api-key-banner" />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      options?.name ? `${key}:${options.name}` : key,
  }),
}));

const failedSong = (detail: string): Generation => ({
  asset: null,
  createdAt: new Date(),
  id: 'gen-1',
  seed: null,
  task: {
    error: { body: { detail }, name: AsyncTaskErrorType.InvalidProviderAPIKey },
    id: 'task-1',
    status: AsyncTaskStatus.Error,
  },
});

const songBatch = (generation: Generation): GenerationBatch => ({
  config: { prompt: 'a lofi song' },
  createdAt: new Date(),
  generations: [generation],
  id: 'batch-1',
  model: 'song-model',
  prompt: 'a lofi song',
  provider: 'fal',
});

describe('MusicGenerationBatchItem with a rejected provider key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a failed song card instead of the API key banner', () => {
    const { container } = render(
      <MusicGenerationBatchItem
        batch={songBatch(failedSong('Provider API error (401): Unauthorized'))}
      />,
    );

    expect(screen.queryByTestId('invalid-api-key-banner')).toBeNull();
    expect(container.querySelector('[data-music-status="error"]')).not.toBeNull();
    expect(screen.getByText('generation.status.invalidApiKey:Fal')).toBeTruthy();
    expect(screen.getByText('generation.status.invalidApiKeyHint')).toBeTruthy();
    // the gateway's own message stays visible
    expect(screen.getByText('Provider API error (401): Unauthorized')).toBeTruthy();
  });

  it('retries the batch from the failed card', () => {
    render(<MusicGenerationBatchItem batch={songBatch(failedSong('InvalidProviderAPIKey'))} />);

    fireEvent.click(screen.getByRole('button', { name: /generation\.actions\.retry/ }));

    expect(recreateMusic).toHaveBeenCalledWith('batch-1');
  });

  it('links the failed card to the provider settings', () => {
    render(<MusicGenerationBatchItem batch={songBatch(failedSong('InvalidProviderAPIKey'))} />);

    // a bare error name is not repeated under the localized message
    expect(screen.queryByText('InvalidProviderAPIKey')).toBeNull();

    fireEvent.click(
      screen.getByRole('button', { name: /generation\.actions\.openProviderSettings/ }),
    );

    expect(navigate).toHaveBeenCalledWith('/settings/provider/fal');
  });
});
