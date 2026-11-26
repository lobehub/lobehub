import { describe, expect, it, vi } from 'vitest';

import {
  DEVICE_BOUND_TO_FIXED_AGENT,
  getDeviceActionErrorMessage,
  getDeviceShareErrorView,
} from './deviceActionError';

vi.mock('i18next', () => ({
  t: (key: string, options?: { ns?: string }) => `${options?.ns}:${key}`,
}));

const trpcError = (message: string, errorData?: { code: string }) =>
  Object.assign(new Error(message), {
    data: { code: 'PRECONDITION_FAILED', errorData, httpStatus: 412 },
  });

describe('getDeviceActionErrorMessage', () => {
  it('maps the fixed-agent refusal to localized copy', () => {
    const error = trpcError('This device is fixed to one or more workspace agents.', {
      code: DEVICE_BOUND_TO_FIXED_AGENT,
    });

    expect(getDeviceActionErrorMessage(error)).toBe('setting:devices.errors.boundToFixedAgent');
  });

  it('shows other server messages verbatim', () => {
    const error = trpcError('Only the enrolling member can change this device.');

    expect(getDeviceActionErrorMessage(error)).toBe(
      'Only the enrolling member can change this device.',
    );
  });

  it('falls back to the generic copy when the error has no message', () => {
    expect(getDeviceActionErrorMessage({ message: '  ' })).toBe('common:operationFailed');
    expect(getDeviceActionErrorMessage(undefined)).toBe('common:operationFailed');
  });
});

describe('getDeviceShareErrorView', () => {
  it('keeps the fixed-agent refusal as the summary', () => {
    const error = trpcError('fixed', { code: DEVICE_BOUND_TO_FIXED_AGENT });

    expect(getDeviceShareErrorView(error, 'Mac')).toEqual({
      summary: 'setting:devices.errors.boundToFixedAgent',
    });
  });

  it('shows a retry line and folds the raw server message into detail', () => {
    const error = trpcError('Device went offline');

    expect(getDeviceShareErrorView(error, 'Mac')).toEqual({
      detail: 'Device went offline',
      summary: 'setting:devices.share.failedRetry',
    });
  });

  it('omits detail when the error carries no message', () => {
    expect(getDeviceShareErrorView(undefined, 'Mac')).toEqual({
      detail: undefined,
      summary: 'setting:devices.share.failedRetry',
    });
  });
});
