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
        (key.startsWith('response.ProviderImageContentModerationCooldown') ||
          key.startsWith('response.ProviderImageContentModerationAccountSuspended'))
      ) {
        const value = zhCNError[key as keyof typeof zhCNError];
        return value?.replace('{{time}}', options?.time ?? '') ?? key;
      }
      if (
        namespaces.includes('error') &&
        (key === 'response.ProviderImageContentModerationWarning' ||
          key === 'response.ProviderImageContentModerationAccountWarning')
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

  it('shows an account suspension notice until the recorded recovery time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T10:00:00Z'));
    const retryAt = '2026-10-31T10:00:00Z';
    const generation: Generation = {
      asyncTaskId: 'task-id',
      createdAt: new Date(),
      id: 'generation-id',
      task: {
        error: {
          body: {
            detail: 'response.ProviderImageContentModerationAccountSuspendedUntil',
            retryAt,
          },
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

    const time = new Intl.DateTimeFormat('zh-CN', {
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
      timeZoneName: 'short',
    }).format(new Date(retryAt));
    expect(
      screen.getByText(
        `因多次触发图片内容安全限制，你的账号已被临时限制使用，预计于 ${time} 恢复。请在恢复后使用合规提示词重试。`,
      ),
    ).toBeTruthy();
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

  it('localizes the account restriction warning before enforcement', () => {
    const generation: Generation = {
      asyncTaskId: 'task-id',
      createdAt: new Date(),
      id: 'generation-id',
      task: {
        error: {
          body: {
            detail:
              'Repeated image safety rejections detected. Further violations may temporarily restrict your account.',
          },
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
