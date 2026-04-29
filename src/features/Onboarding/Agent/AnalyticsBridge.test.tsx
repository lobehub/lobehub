import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setOnboardingAnalyticsClient } from '@/services/onboardingMetrics';

import AnalyticsBridge from './AnalyticsBridge';

vi.mock('@/services/onboardingMetrics', () => ({
  setOnboardingAnalyticsClient: vi.fn(),
}));

const useAnalyticsMock = vi.fn();
vi.mock('@lobehub/analytics/react', () => ({
  useAnalytics: () => useAnalyticsMock(),
}));

const setterMock = vi.mocked(setOnboardingAnalyticsClient);

afterEach(() => {
  cleanup();
  setterMock.mockClear();
  useAnalyticsMock.mockReset();
});

describe('AgentOnboardingAnalyticsBridge', () => {
  it('injects the analytics client on mount and clears it on unmount', () => {
    const analytics = { track: vi.fn() };
    useAnalyticsMock.mockReturnValue({ analytics });

    const { unmount } = render(<AnalyticsBridge />);

    expect(setterMock).toHaveBeenCalledTimes(1);
    expect(setterMock).toHaveBeenLastCalledWith(analytics);

    unmount();
    expect(setterMock).toHaveBeenLastCalledWith(null);
  });

  it('passes null when useAnalytics has no client yet', () => {
    useAnalyticsMock.mockReturnValue({ analytics: null });

    render(<AnalyticsBridge />);

    expect(setterMock).toHaveBeenCalledWith(null);
  });
});
