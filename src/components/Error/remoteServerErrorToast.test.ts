import { beforeEach, describe, expect, it, vi } from 'vitest';

import { remoteServerErrorToast } from './remoteServerErrorToast';

const toastError = vi.fn();

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

vi.mock('i18next', () => ({
  t: vi.fn((key) => `translated_${key}`),
}));

beforeEach(() => {
  toastError.mockClear();
});

describe('remoteServerErrorToast', () => {
  it('reuses one toast id per errorType so repeats collapse instead of stacking', () => {
    remoteServerErrorToast('RemoteServerTimeout');
    remoteServerErrorToast('RemoteServerTimeout');
    remoteServerErrorToast('RemoteServerTimeout');

    expect(toastError).toHaveBeenCalledTimes(3);
    expect(new Set(toastError.mock.calls.map(([options]) => options.id)).size).toBe(1);
    expect(toastError).toHaveBeenLastCalledWith({
      id: 'remote-server-network-error-RemoteServerTimeout',
      title: 'translated_response.RemoteServerTimeout',
    });
  });

  it('gives each errorType its own id', () => {
    remoteServerErrorToast('RemoteServerDNSFailed');
    remoteServerErrorToast('RemoteServerOffline');

    expect(toastError.mock.calls.map(([options]) => options.id)).toEqual([
      'remote-server-network-error-RemoteServerDNSFailed',
      'remote-server-network-error-RemoteServerOffline',
    ]);
  });
});
