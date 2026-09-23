import { ChatErrorType } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sandboxEnv } from '@/envs/sandbox';

import {
  humanizeHeteroDispatchError,
  resolveHeteroDispatchErrorType,
  supportsCloudHeterogeneousSandbox,
} from './heteroErrors';

vi.mock('@/envs/sandbox', () => ({
  sandboxEnv: { HETERO_SANDBOX_AGENT_TYPES: undefined },
}));

const configureAgentTypes = (value: string | undefined) => {
  (sandboxEnv as { HETERO_SANDBOX_AGENT_TYPES?: string }).HETERO_SANDBOX_AGENT_TYPES = value;
};

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

describe('JSON device-gateway dispatch errors', () => {
  it.each(['DEVICE_NOT_FOUND', 'DEVICE_OFFLINE', 'DEVICE_CHANNEL_UNAVAILABLE'])(
    'explains %s and selects the localized device error',
    (code) => {
      const raw = JSON.stringify({ error: code, success: false });

      expect(humanizeHeteroDispatchError(raw)).toBe(humanizeHeteroDispatchError(code));
      expect(resolveHeteroDispatchErrorType(raw)).toBe(ChatErrorType.DeviceGatewayNotConfigured);
    },
  );

  it.each([
    '{"error":"UNKNOWN_DEVICE_ERROR","success":false}',
    '{"error":{"code":"DEVICE_NOT_FOUND"}}',
    '{"error":null}',
    '{"error":42}',
    '{"success":false}',
    '{"error":"DEVICE_NOT_FOUND"',
    'null',
    '[]',
  ])('preserves unrecognized or malformed responses: %s', (raw) => {
    expect(humanizeHeteroDispatchError(raw)).toBe(raw);
    expect(resolveHeteroDispatchErrorType(raw)).toBe(ChatErrorType.ServerAgentRuntimeError);
  });
});

describe('supportsCloudHeterogeneousSandbox', () => {
  beforeEach(() => configureAgentTypes(undefined));

  it('admits what the official runtime image ships, and nothing else', () => {
    expect(supportsCloudHeterogeneousSandbox('claude-code')).toBe(true);
    expect(supportsCloudHeterogeneousSandbox('codex')).toBe(true);
    expect(supportsCloudHeterogeneousSandbox('opencode')).toBe(false);
  });

  it('lets a deployment with its own image widen the set', () => {
    configureAgentTypes('claude-code,codex,opencode');

    expect(supportsCloudHeterogeneousSandbox('opencode')).toBe(true);
  });

  it('replaces the default rather than extending it, so an image can be narrowed', () => {
    configureAgentTypes('opencode');

    expect(supportsCloudHeterogeneousSandbox('opencode')).toBe(true);
    expect(supportsCloudHeterogeneousSandbox('claude-code')).toBe(false);
  });

  it('tolerates spacing and empty entries', () => {
    configureAgentTypes('  opencode , , codex ');

    expect(supportsCloudHeterogeneousSandbox('opencode')).toBe(true);
    expect(supportsCloudHeterogeneousSandbox('codex')).toBe(true);
  });

  it('falls back to the default when the value is blank', () => {
    configureAgentTypes('  ,  ');

    expect(supportsCloudHeterogeneousSandbox('claude-code')).toBe(true);
    expect(supportsCloudHeterogeneousSandbox('opencode')).toBe(false);
  });
});
