/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bootTimingSnapshot: vi.fn<
    () => {
      marks: Record<string, number>;
      spans: { durMs: number; name: string; startMs: number }[];
    }
  >(() => ({ marks: { 'first-paint': 1000 }, spans: [] })),
  getServerConfigStoreState: vi.fn(() => ({ serverConfig: { bootstrapMetricsSampleRate: 1 } })),
  getUserStoreState: vi.fn(() => ({ user: null })),
  isLogin: vi.fn(() => false),
  isProductUsageEventEnabled: vi.fn(() => true),
}));

vi.mock('@/libs/bootTiming', () => ({
  bootTiming: { snapshot: mocks.bootTimingSnapshot },
}));

vi.mock('@/store/serverConfig', () => ({
  getServerConfigStoreState: mocks.getServerConfigStoreState,
}));

vi.mock('@/store/user', () => ({
  getUserStoreState: mocks.getUserStoreState,
}));

vi.mock('@/store/user/selectors', () => ({
  authSelectors: {
    isLogin: mocks.isLogin,
  },
}));

vi.mock('@/libs/analytics/productUsageEvent', () => ({
  isProductUsageEventEnabled: mocks.isProductUsageEventEnabled,
}));

vi.mock('@/const/version', () => ({
  CURRENT_VERSION: '1.0.0-test',
  isDesktop: false,
}));

vi.mock('nanoid', () => ({
  nanoid: () => 'test-anon-id',
}));

const INGEST_URL = 'https://ingest.example.com/boot';

describe('startBootMetricsFinalize', () => {
  let sendBeaconSpy: MockInstance<typeof navigator.sendBeacon>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();

    localStorage.clear();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });

    sendBeaconSpy = vi.spyOn(navigator, 'sendBeacon').mockReturnValue(true);

    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      },
      writable: true,
    });

    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: (cb: IdleRequestCallback) => {
        cb({ didTimeout: false, timeRemaining: () => 50 });
        return 0;
      },
      writable: true,
    });

    Object.defineProperty(window, '__LOBE_BOOT_T_HTML__', {
      configurable: true,
      value: undefined,
      writable: true,
    });

    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([]);
    vi.spyOn(performance, 'getEntriesByName').mockReturnValue([]);

    mocks.bootTimingSnapshot.mockReturnValue({ marks: { 'first-paint': 1000 }, spans: [] });
    mocks.getServerConfigStoreState.mockReturnValue({
      serverConfig: { bootstrapMetricsSampleRate: 1 },
    });
    mocks.getUserStoreState.mockReturnValue({ user: null });
    mocks.isLogin.mockReturnValue(false);
    mocks.isProductUsageEventEnabled.mockReturnValue(true);

    process.env.NEXT_PUBLIC_BOOTSTRAP_METRICS_INGEST_URL = INGEST_URL;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.NEXT_PUBLIC_BOOTSTRAP_METRICS_INGEST_URL;
  });

  it('does not call sendBeacon when ingest URL is unset', async () => {
    delete process.env.NEXT_PUBLIC_BOOTSTRAP_METRICS_INGEST_URL;
    const { startBootMetricsFinalize } = await import('./finalize');
    startBootMetricsFinalize();
    await vi.runAllTimersAsync();
    expect(sendBeaconSpy).not.toHaveBeenCalled();
  });

  it('does not call sendBeacon when telemetry is opted out', async () => {
    mocks.isProductUsageEventEnabled.mockReturnValue(false);
    const { startBootMetricsFinalize } = await import('./finalize');
    startBootMetricsFinalize();
    await vi.runAllTimersAsync();
    expect(sendBeaconSpy).not.toHaveBeenCalled();
  });

  it('does not call sendBeacon when sampled out (sampleRate = 0)', async () => {
    mocks.getServerConfigStoreState.mockReturnValue({
      serverConfig: { bootstrapMetricsSampleRate: 0 },
    });
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { startBootMetricsFinalize } = await import('./finalize');
    startBootMetricsFinalize();
    await vi.runAllTimersAsync();
    expect(sendBeaconSpy).not.toHaveBeenCalled();
  });

  it('calls sendBeacon exactly once with text/plain Blob when all gates pass', async () => {
    const { startBootMetricsFinalize } = await import('./finalize');
    startBootMetricsFinalize();
    await vi.runAllTimersAsync();

    expect(sendBeaconSpy).toHaveBeenCalledTimes(1);

    const [url, blob] = sendBeaconSpy.mock.calls[0] as [string, Blob];
    expect(url).toBe(INGEST_URL);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('text/plain');

    const text = await blob.text();
    const payload = JSON.parse(text);
    expect(payload).toMatchObject({
      appVersion: '1.0.0-test',
      cold: expect.any(Boolean),
      isLogin: false,
      platform: 'web',
      spans: expect.any(Array),
      totalMs: expect.any(Number),
    });
  });

  it('pagehide fallback sends when idle path has not fired, and sent flag prevents double-send', async () => {
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: undefined,
      writable: true,
    });
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: undefined,
      writable: true,
    });

    const { startBootMetricsFinalize } = await import('./finalize');
    startBootMetricsFinalize();

    window.dispatchEvent(new Event('pagehide'));

    await vi.runAllTimersAsync();

    expect(sendBeaconSpy).toHaveBeenCalledTimes(1);
  });

  it('skips sending entirely when the page was hidden at module evaluation', async () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });

    const { startBootMetricsFinalize } = await import('./finalize');
    startBootMetricsFinalize();
    await vi.runAllTimersAsync();

    window.dispatchEvent(new Event('pagehide'));
    await vi.runAllTimersAsync();

    expect(sendBeaconSpy).not.toHaveBeenCalled();
  });

  it('skips sending after a visibilitychange to hidden', async () => {
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: undefined,
      writable: true,
    });
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: undefined,
      writable: true,
    });

    const { startBootMetricsFinalize } = await import('./finalize');
    startBootMetricsFinalize();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));

    window.dispatchEvent(new Event('pagehide'));
    await vi.runAllTimersAsync();

    expect(sendBeaconSpy).not.toHaveBeenCalled();
  });

  it('marks the device as seen before the sampling gate, even when sampled out', async () => {
    mocks.getServerConfigStoreState.mockReturnValue({
      serverConfig: { bootstrapMetricsSampleRate: 0 },
    });
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    expect(localStorage.getItem('lobe:boot:seen')).toBeNull();

    const { startBootMetricsFinalize } = await import('./finalize');
    startBootMetricsFinalize();
    await vi.runAllTimersAsync();

    expect(sendBeaconSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem('lobe:boot:seen')).toBe('1');
  });

  it('reports cold=true on first boot and cold=false on the next boot', async () => {
    const { startBootMetricsFinalize: first } = await import('./finalize');
    first();
    await vi.runAllTimersAsync();

    const firstPayload = JSON.parse(await (sendBeaconSpy.mock.calls[0][1] as Blob).text());
    expect(firstPayload.cold).toBe(true);

    vi.resetModules();
    sendBeaconSpy.mockClear();

    const { startBootMetricsFinalize: second } = await import('./finalize');
    second();
    await vi.runAllTimersAsync();

    const secondPayload = JSON.parse(await (sendBeaconSpy.mock.calls[0][1] as Blob).text());
    expect(secondPayload.cold).toBe(false);
  });

  it('leaves sent false when sendBeacon returns false, so pagehide retries', async () => {
    sendBeaconSpy.mockReturnValue(false);

    const { startBootMetricsFinalize } = await import('./finalize');
    startBootMetricsFinalize();
    await vi.runAllTimersAsync();

    expect(sendBeaconSpy).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('pagehide'));
    await vi.runAllTimersAsync();

    expect(sendBeaconSpy).toHaveBeenCalledTimes(2);
  });

  it('does not send when payload build returns null (no first-paint and no fcp)', async () => {
    mocks.bootTimingSnapshot.mockReturnValue({ marks: {}, spans: [] });

    const { startBootMetricsFinalize } = await import('./finalize');
    startBootMetricsFinalize();
    await vi.runAllTimersAsync();

    expect(sendBeaconSpy).not.toHaveBeenCalled();
  });
});
