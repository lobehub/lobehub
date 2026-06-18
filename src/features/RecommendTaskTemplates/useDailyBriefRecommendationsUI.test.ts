/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';

import { taskTemplateKeys } from '@/libs/swr/keys';

import {
  resolveDailyBriefRecommendationDisplayMode,
  resolveDailyBriefRecommendationRequest,
} from './useDailyBriefRecommendationsUI';

describe('resolveDailyBriefRecommendationRequest', () => {
  it('keeps the cache key available while interests are still initializing', () => {
    const loading = resolveDailyBriefRecommendationRequest({
      interestKeys: null,
      isLogin: true,
      locale: 'zh-CN',
      recommendationCount: 3,
      refreshSeed: '',
    });
    const ready = resolveDailyBriefRecommendationRequest({
      interestKeys: ['ai'],
      isLogin: true,
      locale: 'zh-CN',
      recommendationCount: 3,
      refreshSeed: '',
    });

    expect(loading.key).toEqual(ready.key);
    expect(loading.shouldFetch).toBe(false);
    expect(ready.shouldFetch).toBe(true);
  });

  it('does not include interests in the persisted recommendation cache key', () => {
    const ai = resolveDailyBriefRecommendationRequest({
      interestKeys: ['ai'],
      isLogin: true,
      locale: 'zh-CN',
      recommendationCount: 3,
      refreshSeed: 'seed',
    });
    const research = resolveDailyBriefRecommendationRequest({
      interestKeys: ['research'],
      isLogin: true,
      locale: 'zh-CN',
      recommendationCount: 3,
      refreshSeed: 'seed',
    });

    expect(ai.key).toEqual(research.key);
    expect(ai.key).toEqual(taskTemplateKeys.listDailyRecommend('seed', 3, 'zh-CN'));
  });

  it('keeps refresh seed, count, and locale in the cache key', () => {
    expect(
      resolveDailyBriefRecommendationRequest({
        interestKeys: [],
        isLogin: true,
        locale: 'zh-CN',
        recommendationCount: 3,
        refreshSeed: 'seed-a',
      }).key,
    ).not.toEqual(
      resolveDailyBriefRecommendationRequest({
        interestKeys: [],
        isLogin: true,
        locale: 'en-US',
        recommendationCount: 6,
        refreshSeed: 'seed-b',
      }).key,
    );
  });

  it('disables the cache key before login', () => {
    expect(
      resolveDailyBriefRecommendationRequest({
        interestKeys: [],
        isLogin: false,
        locale: 'zh-CN',
        recommendationCount: 3,
        refreshSeed: '',
      }),
    ).toEqual({ key: null, shouldFetch: false });
  });
});

describe('resolveDailyBriefRecommendationDisplayMode', () => {
  it('keeps cached cards visible while interests are still initializing', () => {
    expect(
      resolveDailyBriefRecommendationDisplayMode({
        canFetchRecommendations: false,
        hasRecommendationKey: true,
        hasTemplates: true,
        isInit: false,
        isLoading: false,
        isValidating: false,
        isWaitingForInterestsFetch: false,
      }),
    ).toBe('cards');
  });

  it('keeps skeleton visible while the first ready-interest fetch is pending', () => {
    expect(
      resolveDailyBriefRecommendationDisplayMode({
        canFetchRecommendations: true,
        hasRecommendationKey: true,
        hasTemplates: false,
        isInit: true,
        isLoading: false,
        isValidating: true,
        isWaitingForInterestsFetch: false,
      }),
    ).toBe('skeleton');
  });

  it('keeps skeleton visible before the first ready-interest fetch starts', () => {
    expect(
      resolveDailyBriefRecommendationDisplayMode({
        canFetchRecommendations: true,
        hasRecommendationKey: true,
        hasTemplates: false,
        isInit: true,
        isLoading: false,
        isValidating: false,
        isWaitingForInterestsFetch: true,
      }),
    ).toBe('skeleton');
  });

  it('hides an initialized empty recommendation result only when idle', () => {
    expect(
      resolveDailyBriefRecommendationDisplayMode({
        canFetchRecommendations: true,
        hasRecommendationKey: true,
        hasTemplates: false,
        isInit: true,
        isLoading: false,
        isValidating: false,
        isWaitingForInterestsFetch: false,
      }),
    ).toBe('hidden');
  });
});
