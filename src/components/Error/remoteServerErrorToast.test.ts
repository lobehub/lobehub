import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { remoteServerErrorToast } from './remoteServerErrorToast';

const toastError = vi.fn();

vi.mock('@lobehub/ui/base-ui', () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

vi.mock('i18next', () => ({
  t: vi.fn((key) => `translated_${key}`),
}));

beforeEach(() => {
  vi.useFakeTimers();
  toastError.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('remoteServerErrorToast', () => {
  it('shows the same errorType at most once per interval', () => {
    remoteServerErrorToast('RemoteServerTimeout');
    remoteServerErrorToast('RemoteServerTimeout');
    remoteServerErrorToast('RemoteServerTimeout');

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith({
      title: 'translated_response.RemoteServerTimeout',
    });

    vi.advanceTimersByTime(10_000);
    remoteServerErrorToast('RemoteServerTimeout');
    expect(toastError).toHaveBeenCalledTimes(2);
  });

  it('debounces per errorType independently', () => {
    remoteServerErrorToast('RemoteServerDNSFailed');
    remoteServerErrorToast('RemoteServerOffline');

    expect(toastError).toHaveBeenCalledTimes(2);
  });
});
