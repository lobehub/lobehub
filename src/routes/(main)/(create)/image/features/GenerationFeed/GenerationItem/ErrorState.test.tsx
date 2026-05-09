import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AsyncTaskErrorType, AsyncTaskStatus } from '@/types/asyncTask';
import { type Generation, type GenerationBatch } from '@/types/generation';

import { ErrorState } from './ErrorState';

vi.mock('@lobehub/ui', async () => {
  const React = await import('react');

  return {
    ActionIconGroup: () => React.createElement('div', { 'data-testid': 'action-buttons' }),
    Block: ({ children, onClick, style }: any) =>
      React.createElement('div', { onClick, style }, children),
    Center: ({ children }: any) => React.createElement('div', null, children),
    Icon: () => React.createElement('span', { 'data-testid': 'icon' }),
    Text: ({ children }: any) => React.createElement('span', null, children),
  };
});

vi.mock('./styles', () => ({
  styles: {
    generationActionButton: 'generation-actions',
    placeholderContainer: 'placeholder-container',
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: (namespace: string) => ({
    t: (key: string) => {
      if (namespace === 'error' && key === 'response.ProviderImageContentModerationWarning') {
        return 'Translated image moderation warning';
      }

      if (namespace === 'error' && key === 'response.ProviderContentModeration') {
        return 'Translated generic moderation';
      }

      return key;
    },
  }),
}));

describe('ErrorState', () => {
  const generationBatch: GenerationBatch = {
    createdAt: new Date(),
    generations: [],
    id: 'batch-id',
    model: 'gpt-image-2',
    prompt: 'test prompt',
    provider: 'lobehub',
  };

  it('translates provider moderation response keys before rendering', () => {
    const generation: Generation = {
      asyncTaskId: 'task-id',
      createdAt: new Date(),
      id: 'generation-id',
      task: {
        error: {
          body: { detail: 'response.ProviderImageContentModerationWarning' },
          name: AsyncTaskErrorType.ProviderContentModeration,
        },
        id: 'task-id',
        status: AsyncTaskStatus.Error,
      },
    };

    render(
      <ErrorState
        aspectRatio="1 / 1"
        generation={generation}
        generationBatch={generationBatch}
        onCopyError={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('Translated image moderation warning')).toBeTruthy();
    expect(screen.queryByText('response.ProviderImageContentModerationWarning')).toBeNull();
  });

  it('localizes the generic provider moderation fallback message', () => {
    const generation: Generation = {
      asyncTaskId: 'task-id',
      createdAt: new Date(),
      id: 'generation-id',
      task: {
        error: {
          body: { detail: 'Content policy check failed. Revise your prompt and try again.' },
          name: AsyncTaskErrorType.ProviderContentModeration,
        },
        id: 'task-id',
        status: AsyncTaskStatus.Error,
      },
    };

    render(
      <ErrorState
        aspectRatio="1 / 1"
        generation={generation}
        generationBatch={generationBatch}
        onCopyError={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('Translated generic moderation')).toBeTruthy();
    expect(
      screen.queryByText('Content policy check failed. Revise your prompt and try again.'),
    ).toBeNull();
  });
});
