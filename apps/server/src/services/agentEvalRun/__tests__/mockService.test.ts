import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  EVAL_TOOL_MOCK_BASE_URL_ENV,
  getTrustedMockBaseUrl,
  isTrustedMockEndpoint,
} from '../mockService';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getTrustedMockBaseUrl', () => {
  it('is undefined when the deployment has no mock', () => {
    vi.stubEnv(EVAL_TOOL_MOCK_BASE_URL_ENV, '');
    expect(getTrustedMockBaseUrl()).toBeUndefined();
  });

  it('normalises the configured origin and path prefix', () => {
    vi.stubEnv(EVAL_TOOL_MOCK_BASE_URL_ENV, ' https://Mock.Example.com:8443/bench/ ');
    expect(getTrustedMockBaseUrl()).toBe('https://mock.example.com:8443/bench');
  });

  it('fails loudly on a malformed value instead of disabling forwarding silently', () => {
    vi.stubEnv(EVAL_TOOL_MOCK_BASE_URL_ENV, 'not a url');
    expect(() => getTrustedMockBaseUrl()).toThrow(EVAL_TOOL_MOCK_BASE_URL_ENV);
    vi.stubEnv(EVAL_TOOL_MOCK_BASE_URL_ENV, 'ftp://mock.example.com');
    expect(() => getTrustedMockBaseUrl()).toThrow('http(s)');
    vi.stubEnv(EVAL_TOOL_MOCK_BASE_URL_ENV, 'https://user:pw@mock.example.com');
    expect(() => getTrustedMockBaseUrl()).toThrow('credentials');
    vi.stubEnv(EVAL_TOOL_MOCK_BASE_URL_ENV, 'https://mock.example.com/?x=1');
    expect(() => getTrustedMockBaseUrl()).toThrow('query');
  });
});

describe('isTrustedMockEndpoint', () => {
  it('accepts only endpoints on the configured origin and under its prefix', () => {
    vi.stubEnv(EVAL_TOOL_MOCK_BASE_URL_ENV, 'https://mock.example.com/bench');
    expect(isTrustedMockEndpoint('https://mock.example.com/bench/tool-exec/b30/x/exec')).toBe(true);
    expect(isTrustedMockEndpoint('https://mock.example.com/bench')).toBe(true);
    // Same host, outside the prefix or a prefix that only shares a string start.
    expect(isTrustedMockEndpoint('https://mock.example.com/other/exec')).toBe(false);
    expect(isTrustedMockEndpoint('https://mock.example.com/benchmark/exec')).toBe(false);
    // Other origins, even lookalikes.
    expect(isTrustedMockEndpoint('https://evil.example.com/bench/exec')).toBe(false);
    expect(isTrustedMockEndpoint('https://mock.example.com.evil.com/bench/exec')).toBe(false);
    expect(isTrustedMockEndpoint('http://mock.example.com/bench/exec')).toBe(false);
    expect(isTrustedMockEndpoint('https://mock.example.com:444/bench/exec')).toBe(false);
    expect(isTrustedMockEndpoint('https://u:p@mock.example.com/bench/exec')).toBe(false);
    expect(isTrustedMockEndpoint('garbage')).toBe(false);
    expect(isTrustedMockEndpoint(undefined)).toBe(false);
  });

  it('trusts nothing when the deployment has no mock or a broken value', () => {
    vi.stubEnv(EVAL_TOOL_MOCK_BASE_URL_ENV, '');
    expect(isTrustedMockEndpoint('https://mock.example.com/exec')).toBe(false);
    vi.stubEnv(EVAL_TOOL_MOCK_BASE_URL_ENV, 'nope');
    expect(isTrustedMockEndpoint('https://mock.example.com/exec')).toBe(false);
  });
});
