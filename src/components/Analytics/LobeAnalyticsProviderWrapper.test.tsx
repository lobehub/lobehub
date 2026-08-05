import type * as AnalyticsModule from '@lobehub/analytics';
import type * as AnalyticsReactModule from '@lobehub/analytics/react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type * as ReactModule from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUserStore } from '@/store/user';
import type { SPAServerConfig } from '@/types/spaServerConfig';

import { LobeAnalyticsProviderWrapper } from './LobeAnalyticsProviderWrapper';

const analyticsMock = vi.hoisted(() => {
  const postHog = {
    get_property: vi.fn<(property: string) => unknown>(),
    register: vi.fn(),
  };
  const manager = {
    getProvider: vi.fn(() => ({ getNativeInstance: () => postHog })),
    reset: vi.fn(async () => {}),
    setGlobalContext: vi.fn(),
  };

  return {
    captureStates: [] as boolean[],
    config: undefined as AnalyticsModule.AnalyticsConfig | undefined,
    manager,
    postHog,
    providerProps: undefined as AnalyticsReactModule.AnalyticsProviderProps | undefined,
  };
});

vi.mock('@lobehub/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof AnalyticsModule>();

  return {
    ...actual,
    createSingletonAnalytics: (config: AnalyticsModule.AnalyticsConfig) => {
      analyticsMock.config = config;
      return analyticsMock.manager;
    },
  };
});

vi.mock('@lobehub/analytics/react', async (importOriginal) => {
  const actual = await importOriginal<typeof AnalyticsReactModule>();
  const { useEffect, useRef } = await vi.importActual<typeof ReactModule>('react');

  return {
    ...actual,
    AnalyticsProvider: (props: AnalyticsReactModule.AnalyticsProviderProps) => {
      const { captureEnabled = true, children, onInitializeSuccess } = props;
      const initializedRef = useRef(false);
      analyticsMock.captureStates.push(captureEnabled);
      analyticsMock.providerProps = props;

      useEffect(() => {
        if (initializedRef.current) return;
        initializedRef.current = true;
        onInitializeSuccess?.();
      }, [onInitializeSuccess]);

      return children;
    },
  };
});

const serverConfig = {
  analyticsConfig: {
    posthog: {
      debug: true,
      host: 'https://posthog.example.com',
      key: 'ph-key',
    },
  },
} as SPAServerConfig;

beforeEach(() => {
  analyticsMock.captureStates = [];
  analyticsMock.providerProps = undefined;
  analyticsMock.manager.getProvider.mockClear();
  analyticsMock.manager.reset.mockClear();
  analyticsMock.manager.setGlobalContext.mockClear();
  analyticsMock.postHog.get_property.mockReset();
  analyticsMock.postHog.register.mockClear();
  window.__SERVER_CONFIG__ = serverConfig;
  useUserStore.setState({
    isUserStateInit: true,
    settings: { general: { telemetry: true } },
    user: {
      email: 'user@example.com',
      id: 'user-id',
    },
  });
});

afterEach(() => {
  cleanup();
  window.__SERVER_CONFIG__ = undefined;
  useUserStore.setState({
    isUserStateInit: false,
    settings: {},
    user: undefined,
  });
});

describe('LobeAnalyticsProviderWrapper', () => {
  it('starts PostHog opted out and enables capture only after explicit consent is loaded', async () => {
    render(
      <LobeAnalyticsProviderWrapper>
        <div>Analytics child</div>
      </LobeAnalyticsProviderWrapper>,
    );

    expect(screen.getByText('Analytics child')).toBeInTheDocument();
    expect(analyticsMock.config?.captureEnabled).toBe(false);
    expect(analyticsMock.config).not.toHaveProperty('user');
    expect(analyticsMock.config?.providers.posthog).toMatchObject({
      autocapture: false,
      capture_pageleave: false,
      capture_pageview: false,
      debug: true,
      disable_session_recording: true,
      enabled: true,
      host: 'https://posthog.example.com',
      key: 'ph-key',
      mask_all_element_attributes: true,
      mask_all_text: true,
      mask_personal_data_properties: true,
      opt_out_capturing_by_default: true,
      opt_out_persistence_by_default: true,
      person_profiles: 'never',
      property_denylist: expect.arrayContaining([
        '$current_url',
        '$initial_current_url',
        '$initial_ph_keyword',
        '$pathname',
        '$referrer',
        'ph_keyword',
        'title',
      ]),
      save_campaign_params: false,
      save_referrer: false,
    });

    await waitFor(() => {
      expect(analyticsMock.providerProps?.captureEnabled).toBe(true);
    });
    expect(analyticsMock.captureStates[0]).toBe(false);
  });

  it('keeps capture disabled until user state initialization completes', async () => {
    useUserStore.setState({ isUserStateInit: false });

    render(
      <LobeAnalyticsProviderWrapper>
        <div>Analytics child</div>
      </LobeAnalyticsProviderWrapper>,
    );

    await waitFor(() => {
      expect(analyticsMock.manager.setGlobalContext).toHaveBeenCalledOnce();
    });
    expect(analyticsMock.captureStates).not.toContain(true);
    expect(analyticsMock.providerProps?.captureEnabled).toBe(false);
  });

  it('clears a persisted identified user before enabling capture', async () => {
    analyticsMock.postHog.get_property.mockImplementation((property) =>
      property === '$user_id' ? 'legacy-user-id' : undefined,
    );
    let resolveReset: (() => void) | undefined;
    analyticsMock.manager.reset.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveReset = resolve;
        }),
    );

    render(
      <LobeAnalyticsProviderWrapper>
        <div>Analytics child</div>
      </LobeAnalyticsProviderWrapper>,
    );

    await waitFor(() => {
      expect(analyticsMock.manager.reset).toHaveBeenCalledOnce();
    });
    expect(analyticsMock.captureStates).not.toContain(true);

    await act(async () => {
      resolveReset?.();
    });

    await waitFor(() => {
      expect(analyticsMock.providerProps?.captureEnabled).toBe(true);
    });
  });

  it('clears in-memory analytics identity when consent is withdrawn', async () => {
    render(
      <LobeAnalyticsProviderWrapper>
        <div>Analytics child</div>
      </LobeAnalyticsProviderWrapper>,
    );

    await waitFor(() => {
      expect(analyticsMock.providerProps?.captureEnabled).toBe(true);
    });

    act(() => {
      useUserStore.setState({ settings: { general: { telemetry: false } } });
    });

    await waitFor(() => {
      expect(analyticsMock.providerProps?.captureEnabled).toBe(false);
      expect(analyticsMock.manager.reset).toHaveBeenCalledOnce();
    });
  });
});
