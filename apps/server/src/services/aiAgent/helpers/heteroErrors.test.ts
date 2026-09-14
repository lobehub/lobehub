import { ChatErrorType } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { humanizeHeteroDispatchError, resolveHeteroDispatchErrorType } from './heteroErrors';

describe('humanizeHeteroDispatchError', () => {
  it('replaces a bare gateway code with a sentence the user can act on', () => {
    // `DEVICE_OFFLINE` used to render verbatim in the error card.
    const headline = humanizeHeteroDispatchError('DEVICE_OFFLINE');

    expect(headline).not.toBe('DEVICE_OFFLINE');
    expect(headline).toContain('offline');
    expect(headline).toContain('desktop app');
  });

  it('looks past the status annotation the gateway client appends', () => {
    // The device-gateway client answers `CODE (HTTP 503)` when the gateway sent
    // no body; an exact-match lookup would fall through to the raw string.
    expect(humanizeHeteroDispatchError('DEVICE_CHANNEL_UNAVAILABLE (HTTP 503)')).toContain(
      "isn't reachable right now",
    );
  });

  it('keeps the existing gateway-not-configured copy', () => {
    expect(humanizeHeteroDispatchError('GATEWAY_NOT_CONFIGURED')).toContain(
      "run device gateway isn't configured",
    );
  });

  it('passes unknown text through and falls back when there is none', () => {
    expect(humanizeHeteroDispatchError('spawn failed')).toBe('spawn failed');
    expect(humanizeHeteroDispatchError()).toBe('Device dispatch failed');
  });
});

describe('resolveHeteroDispatchErrorType', () => {
  it('routes every unreachable-device flavour to the localized device error', () => {
    for (const raw of [
      'DEVICE_OFFLINE',
      'DEVICE_CHANNEL_UNAVAILABLE (HTTP 503)',
      'DEVICE_NOT_FOUND (HTTP 404)',
      'GATEWAY_NOT_CONFIGURED',
    ]) {
      expect(resolveHeteroDispatchErrorType(raw)).toBe(ChatErrorType.DeviceGatewayNotConfigured);
    }
  });

  it('keeps the generic runtime error for anything else', () => {
    expect(resolveHeteroDispatchErrorType('spawn failed')).toBe(
      ChatErrorType.ServerAgentRuntimeError,
    );
    expect(resolveHeteroDispatchErrorType()).toBe(ChatErrorType.ServerAgentRuntimeError);
  });
});
