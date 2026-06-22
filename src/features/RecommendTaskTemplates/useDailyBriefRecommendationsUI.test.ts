/**
 * @vitest-environment happy-dom
 */
import type { TaskTemplate } from '@lobechat/const';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TASK_TEMPLATE_RECOMMENDATION_CACHE_VERSION, taskTemplateKeys } from '@/libs/swr/keys';
import { taskTemplateService } from '@/services/taskTemplate';

import {
  resolveDailyBriefRecommendationDisplayMode,
  resolveDailyBriefRecommendationRequest,
  useDailyBriefRecommendationsUI,
} from './useDailyBriefRecommendationsUI';

const {
  mockMutate,
  mockSetRefreshSeed,
  mockUseFetchBriefs,
  mockUseFetchLobehubConnectorConnections,
  mockUseFetchUserComposioConnections,
  mockUseResolvedInterestKeys,
  mockUseSWR,
} = vi.hoisted(() => ({
  mockMutate: vi.fn(),
  mockSetRefreshSeed: vi.fn(),
  mockUseFetchBriefs: vi.fn(),
  mockUseFetchLobehubConnectorConnections: vi.fn(),
  mockUseFetchUserComposioConnections: vi.fn(),
  mockUseResolvedInterestKeys: vi.fn(),
  mockUseSWR: vi.fn(),
}));

vi.mock('ahooks', () => ({
  useSessionStorageState: () => ['', mockSetRefreshSeed],
}));

vi.mock('antd', () => ({
  App: {
    useApp: () => ({ message: { error: vi.fn() } }),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-US', resolvedLanguage: 'en-US' },
    t: (key: string) => key,
  }),
}));

vi.mock('swr', () => ({
  default: mockUseSWR,
}));

vi.mock('@/store/brief', () => ({
  useBriefStore: (selector: (state: any) => unknown) =>
    selector({
      isBriefsInit: true,
      useFetchBriefs: mockUseFetchBriefs,
    }),
}));

vi.mock('@/store/tool', () => ({
  useToolStore: (selector: (state: any) => unknown) =>
    selector({
      useFetchLobehubSkillConnections: mockUseFetchLobehubConnectorConnections,
      useFetchUserComposioConnections: mockUseFetchUserComposioConnections,
    }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: any) => unknown) =>
    selector({
      isLoaded: true,
      isSignedIn: true,
      user: { interests: ['coding'] },
    }),
}));

vi.mock('@/services/taskTemplate', () => ({
  taskTemplateService: {
    dismiss: vi.fn(),
    listDailyRecommend: vi.fn(),
    recordCreated: vi.fn(),
  },
}));

vi.mock('./useResolvedInterestKeys', () => ({
  useResolvedInterestKeys: mockUseResolvedInterestKeys,
}));

const template = {
  category: 'engineering',
  connectors: [],
  cronPattern: '0 9 * * *',
  description: 'Description',
  id: 101,
  identifier: 'daily-engineering',
  instruction: 'Instruction',
  interests: ['coding'],
  title: 'Title',
} satisfies TaskTemplate;

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
    expect(ai.key?.[0]).toBe(
      `taskTemplate:listDailyRecommend:v${TASK_TEMPLATE_RECOMMENDATION_CACHE_VERSION}`,
    );
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

describe('useDailyBriefRecommendationsUI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseResolvedInterestKeys.mockReturnValue(['coding']);
    mockUseSWR.mockReturnValue({
      data: { data: [template], success: true },
      isLoading: false,
      isValidating: false,
      mutate: mockMutate,
    });
  });

  it('returns cards when recommendations are loaded and forwards locale/count inputs', async () => {
    vi.mocked(taskTemplateService.listDailyRecommend).mockResolvedValue({
      data: [template],
      success: true,
    });

    const { result } = renderHook(() => useDailyBriefRecommendationsUI({ count: 2 }));

    expect(result.current).toMatchObject({ mode: 'cards', templates: [template] });
    expect(mockUseSWR.mock.calls[0][0]).toEqual(
      taskTemplateKeys.listDailyRecommend('', 2, 'en-US'),
    );

    const fetcher = mockUseSWR.mock.calls[0][1];
    await fetcher();

    expect(taskTemplateService.listDailyRecommend).toHaveBeenCalledWith(['coding'], {
      count: 2,
      locale: 'en-US',
      refreshSeed: undefined,
    });
  });

  it('drops recommendations that are missing connectors', () => {
    const templateWithoutConnectors = {
      category: 'engineering',
      cronPattern: '0 9 * * *',
      description: 'Description',
      id: 102,
      identifier: 'legacy-daily-engineering',
      instruction: 'Instruction',
      interests: ['coding'],
      title: 'Legacy title',
    } satisfies Omit<TaskTemplate, 'connectors'>;
    mockUseSWR.mockReturnValue({
      data: { data: [templateWithoutConnectors], success: true },
      isLoading: false,
      isValidating: false,
      mutate: mockMutate,
    });

    const { result } = renderHook(() => useDailyBriefRecommendationsUI());

    expect(result.current).toEqual({ mode: 'hidden' });
    expect(mockUseFetchUserComposioConnections).toHaveBeenCalledWith(false);
    expect(mockUseFetchLobehubConnectorConnections).toHaveBeenCalledWith(false);
  });

  it('drops recommendations with malformed connector entries', () => {
    const templateWithMalformedConnectors = {
      ...template,
      connectors: [null],
    };
    mockUseSWR.mockReturnValue({
      data: { data: [templateWithMalformedConnectors], success: true },
      isLoading: false,
      isValidating: false,
      mutate: mockMutate,
    });

    const { result } = renderHook(() => useDailyBriefRecommendationsUI());

    expect(result.current).toEqual({ mode: 'hidden' });
    expect(mockUseFetchUserComposioConnections).toHaveBeenCalledWith(false);
    expect(mockUseFetchLobehubConnectorConnections).toHaveBeenCalledWith(false);
  });

  it('drops recommendations with unknown connector identifiers', () => {
    const templateWithUnknownConnector = {
      ...template,
      connectors: [{ identifier: 'nonexistent-x', required: true, source: 'lobehub' }],
    };
    mockUseSWR.mockReturnValue({
      data: { data: [templateWithUnknownConnector], success: true },
      isLoading: false,
      isValidating: false,
      mutate: mockMutate,
    });

    const { result } = renderHook(() => useDailyBriefRecommendationsUI());

    expect(result.current).toEqual({ mode: 'hidden' });
    expect(mockUseFetchUserComposioConnections).toHaveBeenCalledWith(false);
    expect(mockUseFetchLobehubConnectorConnections).toHaveBeenCalledWith(false);
  });

  it('treats non-array recommendation payloads as empty data', () => {
    mockUseSWR.mockReturnValue({
      data: { data: { ...template }, success: true },
      isLoading: false,
      isValidating: false,
      mutate: mockMutate,
    });

    const { result } = renderHook(() => useDailyBriefRecommendationsUI());

    expect(result.current).toEqual({ mode: 'hidden' });
    expect(mockUseFetchUserComposioConnections).toHaveBeenCalledWith(false);
    expect(mockUseFetchLobehubConnectorConnections).toHaveBeenCalledWith(false);
  });

  it('normalizes cached rows before removing a card', () => {
    mockUseSWR.mockReturnValue({
      data: { data: [template, null], success: true },
      isLoading: false,
      isValidating: false,
      mutate: mockMutate,
    });

    const { result } = renderHook(() => useDailyBriefRecommendationsUI());

    expect(result.current.mode).toBe('cards');
    if (result.current.mode !== 'cards') return;

    result.current.onCreated(template.id);

    const updater = mockMutate.mock.calls[0][0] as (current?: {
      data: unknown;
      success: boolean;
    }) => unknown;
    expect(updater({ data: [template, null], success: true })).toEqual({
      data: [],
      success: true,
    });
    expect(updater({ data: { ...template }, success: true })).toEqual({
      data: [],
      success: true,
    });
    expect(mockMutate.mock.calls[0][1]).toEqual({ revalidate: false });
  });

  it('drops legacy recommendations from pre-Market task-template servers', () => {
    const legacyServerTemplate = {
      category: 'engineering',
      cronPattern: '0 9 * * *',
      id: 'oss-intel-daily',
      interests: ['coding'],
      requiresSkills: [{ provider: 'github', source: 'lobehub' }],
    };
    mockUseSWR.mockReturnValue({
      data: { data: [legacyServerTemplate], success: true },
      isLoading: false,
      isValidating: false,
      mutate: mockMutate,
    });

    const { result } = renderHook(() => useDailyBriefRecommendationsUI());

    expect(result.current).toEqual({ mode: 'hidden' });
    expect(mockUseFetchUserComposioConnections).toHaveBeenCalledWith(false);
    expect(mockUseFetchLobehubConnectorConnections).toHaveBeenCalledWith(false);
  });

  it('logs recommendation request errors instead of treating them as normal empty data', async () => {
    const error = new Error('market down');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockUseSWR.mockReturnValue({
      error,
      isLoading: false,
      isValidating: false,
      mutate: mockMutate,
    });

    const { result } = renderHook(() => useDailyBriefRecommendationsUI());

    try {
      expect(result.current).toEqual({ mode: 'hidden' });
      await waitFor(() =>
        expect(consoleErrorSpy).toHaveBeenCalledWith('[taskTemplate:listDailyRecommend]', error),
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
