import { afterEach, describe, expect, it, vi } from 'vitest';

import { topicService } from '@/services/topic';

import {
  ONBOARDING_FEEDBACK_CONSTANTS,
  submitOnboardingComment,
  submitOnboardingRating,
} from './index';

describe('submitOnboardingRating', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes the rating to topic.metadata.onboardingFeedback and returns the timestamp', async () => {
    const updateTopicMetadata = vi
      .spyOn(topicService, 'updateTopicMetadata')
      .mockResolvedValue(undefined as never);

    const result = await submitOnboardingRating({ rating: 'good', topicId: 'topic-1' });

    expect(updateTopicMetadata).toHaveBeenCalledTimes(1);
    const [topicId, metadata] = updateTopicMetadata.mock.calls[0]!;
    expect(topicId).toBe('topic-1');
    expect(metadata.onboardingFeedback?.rating).toBe('good');
    expect(metadata.onboardingFeedback?.comment).toBeUndefined();
    expect(typeof metadata.onboardingFeedback?.submittedAt).toBe('string');
    expect(result.submittedAt).toBe(metadata.onboardingFeedback?.submittedAt);
  });

  it('emits the analytics event without any free-form comment', async () => {
    vi.spyOn(topicService, 'updateTopicMetadata').mockResolvedValue(undefined as never);

    const track = vi.fn();
    await submitOnboardingRating({ rating: 'good', topicId: 'topic-2' }, { analytics: { track } });

    expect(track).toHaveBeenCalledTimes(1);
    const event = track.mock.calls[0]![0];
    expect(event.name).toBe(ONBOARDING_FEEDBACK_CONSTANTS.EVENT_NAME);
    expect(event.properties).toEqual({
      rating: 'good',
      spm: ONBOARDING_FEEDBACK_CONSTANTS.SPM,
    });
    expect(Object.keys(event.properties)).not.toContain('comment');
  });

  it('rejects when topic metadata persistence fails', async () => {
    vi.spyOn(topicService, 'updateTopicMetadata').mockRejectedValue(
      new Error('topic write failed'),
    );

    await expect(submitOnboardingRating({ rating: 'good', topicId: 'topic-3' })).rejects.toThrow(
      'topic write failed',
    );
  });

  it('does not throw when analytics emission fails', async () => {
    vi.spyOn(topicService, 'updateTopicMetadata').mockResolvedValue(undefined as never);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      submitOnboardingRating(
        { rating: 'good', topicId: 'topic-4' },
        {
          analytics: {
            track: () => {
              throw new Error('analytics down');
            },
          },
        },
      ),
    ).resolves.toMatchObject({ submittedAt: expect.any(String) });
    expect(consoleError).toHaveBeenCalled();
  });
});

describe('submitOnboardingComment', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('patches topic metadata with the trimmed comment carrying rating + submittedAt forward', async () => {
    const updateTopicMetadata = vi
      .spyOn(topicService, 'updateTopicMetadata')
      .mockResolvedValue(undefined as never);

    await submitOnboardingComment({
      comment: '  great onboarding  ',
      rating: 'good',
      submittedAt: '2026-04-16T00:00:00.000Z',
      topicId: 'topic-5',
    });

    expect(updateTopicMetadata).toHaveBeenCalledTimes(1);
    const [topicId, metadata] = updateTopicMetadata.mock.calls[0]!;
    expect(topicId).toBe('topic-5');
    expect(metadata.onboardingFeedback).toEqual({
      comment: 'great onboarding',
      rating: 'good',
      submittedAt: '2026-04-16T00:00:00.000Z',
    });
  });

  it('truncates comments longer than the configured cap', async () => {
    const updateTopicMetadata = vi
      .spyOn(topicService, 'updateTopicMetadata')
      .mockResolvedValue(undefined as never);

    const oversize = 'x'.repeat(ONBOARDING_FEEDBACK_CONSTANTS.COMMENT_MAX_LENGTH + 50);
    await submitOnboardingComment({
      comment: oversize,
      rating: 'bad',
      submittedAt: '2026-04-16T00:00:00.000Z',
      topicId: 'topic-6',
    });

    const metadata = updateTopicMetadata.mock.calls[0]![1];
    expect(metadata.onboardingFeedback?.comment?.length).toBe(
      ONBOARDING_FEEDBACK_CONSTANTS.COMMENT_MAX_LENGTH,
    );
  });

  it('no-ops when the trimmed comment is empty', async () => {
    const updateTopicMetadata = vi
      .spyOn(topicService, 'updateTopicMetadata')
      .mockResolvedValue(undefined as never);

    await submitOnboardingComment({
      comment: '   ',
      rating: 'good',
      submittedAt: '2026-04-16T00:00:00.000Z',
      topicId: 'topic-7',
    });

    expect(updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('rejects when topic metadata persistence fails so the UI can surface an error', async () => {
    vi.spyOn(topicService, 'updateTopicMetadata').mockRejectedValue(
      new Error('topic write failed'),
    );

    await expect(
      submitOnboardingComment({
        comment: 'feedback',
        rating: 'good',
        submittedAt: '2026-04-16T00:00:00.000Z',
        topicId: 'topic-8',
      }),
    ).rejects.toThrow('topic write failed');
  });
});
