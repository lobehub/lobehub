import type { PostHogProviderAnalyticsConfig } from '@lobehub/analytics';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SPAServerConfig } from '@/types/spaServerConfig';

import { LobeAnalyticsProviderWrapper } from './LobeAnalyticsProviderWrapper';

const providerMock = vi.hoisted(() => ({
  props: undefined as
    | {
        children: ReactNode;
        postHogConfig: PostHogProviderAnalyticsConfig;
      }
    | undefined,
}));

vi.mock('@/components/Analytics/LobeAnalyticsProvider', () => ({
  LobeAnalyticsProvider: (props: {
    children: ReactNode;
    postHogConfig: PostHogProviderAnalyticsConfig;
  }) => {
    providerMock.props = props;
    return props.children;
  },
}));

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
  providerMock.props = undefined;
  window.__SERVER_CONFIG__ = serverConfig;
});

afterEach(() => {
  cleanup();
  window.__SERVER_CONFIG__ = undefined;
});

describe('LobeAnalyticsProviderWrapper', () => {
  it('enables PostHog history-change pageview capture for the SPA provider', () => {
    render(
      <LobeAnalyticsProviderWrapper>
        <div>Analytics child</div>
      </LobeAnalyticsProviderWrapper>,
    );

    expect(screen.getByText('Analytics child')).toBeInTheDocument();
    expect(providerMock.props?.postHogConfig).toMatchObject({
      capture_pageview: 'history_change',
      debug: true,
      enabled: true,
      host: 'https://posthog.example.com',
      key: 'ph-key',
      person_profiles: 'always',
    });
  });
});
