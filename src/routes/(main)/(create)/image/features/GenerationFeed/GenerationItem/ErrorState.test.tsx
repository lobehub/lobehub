import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AsyncTaskErrorType, AsyncTaskStatus } from '@/types/asyncTask';
import { type Generation, type GenerationBatch } from '@/types/generation';

import zhCNError from '../../../../../../../../locales/zh-CN/error.json';
import { ErrorState } from './ErrorState';

vi.mock('./styles', () => ({
  styles: {
    generationActionButton: 'generation-actions',
    placeholderContainer: 'placeholder-container',
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: (namespace: string | string[]) => ({
    i18n: { language: 'zh-CN', resolvedLanguage: 'zh-CN' },
    t: (key: string, options?: { time?: string }) => {
      const namespaces = Array.isArray(namespace) ? namespace : [namespace];
      if (
        namespaces.includes('error') &&
        key.startsWith('response.ProviderImageContentModerationCooldown')
      ) {
        const value = zhCNError[key as keyof typeof zhCNError];
        return value?.replace('{{time}}', options?.time ?? '') ?? key;
      }
      if (
        namespaces.includes('error') &&
        key === 'response.ProviderImageContentModerationWarning'
      ) {
        return 'Translated image moderation warning';
      }

      if (namespaces.includes('error') && key === 'response.ProviderContentModeration') {
        return 'Translated generic moderation';
      }

      return key;
    },
  }),
}));

describe('ErrorState', () => {
  afterEach(() => vi.useRealTimers());
  const generationBatch: GenerationBatch = {
    createdAt: new Date(),
    generations: [],
    id: 'batch-id',
    model: 'gpt-image-2',
    prompt: 'test prompt',
    provider: 'lobehub',
  };

  it.each([
    [undefined, '因多次触发内容安全限制，图片生成已暂时暂停。请调整提示词，稍后重试。'],
    ['invalid', '因多次触发内容安全限制，图片生成已暂时暂停。请调整提示词，稍后重试。'],
    ['2026-09-07T10:00:00Z', '此次生成因内容安全限制暂停，本次等待期已结束。请调整提示词后重试。'],
  ])('handles historical retry time %s', (retryAt, expected) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T10:00:00Z'));
    const generation: Generation = {
      asyncTaskId: 'task-id',
      createdAt: new Date(),
      id: 'generation-id',
      task: {
        id: 'task-id',
        status: AsyncTaskStatus.Error,
        error: {
          name: AsyncTaskErrorType.ProviderContentModeration,
          body: { detail: 'response.ProviderImageContentModerationCooldown', retryAt },
        },
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
    expect(screen.getByText(expected!)).toBeTruthy();
    expect(screen.queryByText(/预计于/)).toBeNull();
  });

  it('shows the retry time and updates when the recorded waiting period ends', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T10:00:00Z'));
    const retryAt = '2026-09-08T10:01:00Z';
    const generation: Generation = {
      asyncTaskId: 'task-id',
      createdAt: new Date(),
      id: 'generation-id',
      task: {
        id: 'task-id',
        status: AsyncTaskStatus.Error,
        error: {
          name: AsyncTaskErrorType.ProviderContentModeration,
          body: {
            detail:
              'Image generation is temporarily paused due to repeated safety rejections. Try again later with safer prompts.',
            retryAt,
          },
        },
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
    const time = new Intl.DateTimeFormat('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(new Date(retryAt));
    expect(
      screen.getByText(
        `因多次触发内容安全限制，图片生成已暂时暂停，预计于 ${time} 恢复。请调整提示词后重试。`,
      ),
    ).toBeTruthy();
    act(() => vi.advanceTimersByTime(60_000));
    expect(
      screen.getByText('此次生成因内容安全限制暂停，本次等待期已结束。请调整提示词后重试。'),
    ).toBeTruthy();
    expect(screen.queryByText(/预计于/)).toBeNull();
  });

  it.each([
    'Image generation is temporarily paused due to repeated safety rejections. Try again later with safer prompts.',
    'response.ProviderImageContentModerationCooldown',
  ])('localizes image cooldown details: %s', (detail) => {
    const generation: Generation = {
      asyncTaskId: 'task-id',
      createdAt: new Date(),
      id: 'generation-id',
      task: {
        error: { body: { detail }, name: AsyncTaskErrorType.ProviderContentModeration },
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

    expect(
      screen.getByText('因多次触发内容安全限制，图片生成已暂时暂停。请调整提示词，稍后重试。'),
    ).toBeTruthy();
    expect(screen.queryByText(detail)).toBeNull();
  });

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

  it.each([
    'Content policy check failed. Revise your prompt and try again.',
    'Content policy check failed. Please revise your prompt.',
  ])('localizes the generic provider moderation fallback message: %s', (detail) => {
    const generation: Generation = {
      asyncTaskId: 'task-id',
      createdAt: new Date(),
      id: 'generation-id',
      task: {
        error: {
          body: { detail },
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
    expect(screen.queryByText(detail)).toBeNull();
  });
});
