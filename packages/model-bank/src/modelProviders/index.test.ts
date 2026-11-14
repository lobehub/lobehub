import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type ModelProviderCard } from '../types';
import {
  DEFAULT_MODEL_PROVIDER_LIST,
  getProviderDisplayName,
  isProviderDeviceOnly,
  isProviderDisableBrowserRequest,
  isProviderFetchOnClient,
  isProviderOAuthDeviceFlow,
} from './index';

describe('model provider predicates', () => {
  const originalProviders = [...DEFAULT_MODEL_PROVIDER_LIST];

  const createProvider = (overrides: Partial<ModelProviderCard>): ModelProviderCard => ({
    chatModels: [],
    id: 'test-provider',
    name: 'Test Provider',
    settings: {},
    url: 'https://example.com',
    ...overrides,
  });

  beforeEach(() => {
    DEFAULT_MODEL_PROVIDER_LIST.length = 0;
    DEFAULT_MODEL_PROVIDER_LIST.push(
      createProvider({ id: 'root-disabled', disableBrowserRequest: true }),
      createProvider({ id: 'settings-disabled', settings: { disableBrowserRequest: true } }),
      createProvider({ id: 'oauth-provider', settings: { authType: 'oauthDeviceFlow' } }),
      createProvider({ id: 'enabled-provider' }),
    );
  });

  afterEach(() => {
    DEFAULT_MODEL_PROVIDER_LIST.length = 0;
    DEFAULT_MODEL_PROVIDER_LIST.push(...originalProviders);
  });

  it('returns true for providers with root-level disableBrowserRequest', () => {
    expect(isProviderDisableBrowserRequest('root-disabled')).toBe(true);
  });

  it('returns true for providers with settings.disableBrowserRequest', () => {
    expect(isProviderDisableBrowserRequest('settings-disabled')).toBe(true);
  });

  it('returns false for providers without disableBrowserRequest', () => {
    expect(isProviderDisableBrowserRequest('enabled-provider')).toBe(false);
  });

  it('returns false for unknown provider id', () => {
    expect(isProviderDisableBrowserRequest('not-exists')).toBe(false);
  });

  it('resolves a provider id to its display name and falls back to the id', () => {
    expect(getProviderDisplayName('enabled-provider')).toBe('Test Provider');
    expect(getProviderDisplayName('not-exists')).toBe('not-exists');
  });

  it('detects OAuth device flow providers', () => {
    expect(isProviderOAuthDeviceFlow('oauth-provider')).toBe(true);
    expect(isProviderOAuthDeviceFlow('enabled-provider')).toBe(false);
    expect(isProviderOAuthDeviceFlow('not-exists')).toBe(false);
    expect(isProviderOAuthDeviceFlow()).toBe(false);
  });
});

describe('isProviderFetchOnClient', () => {
  it('runs a local provider on the device unless fetchOnClient says otherwise', () => {
    expect(isProviderFetchOnClient('lmstudio', undefined)).toBe(true);
    expect(isProviderFetchOnClient('ollama', { keyVaults: {} })).toBe(true);
    expect(isProviderFetchOnClient('lmstudio', { fetchOnClient: false })).toBe(false);
  });

  it('runs on the server without an endpoint or a key', () => {
    expect(isProviderFetchOnClient('openai', { fetchOnClient: true, keyVaults: {} })).toBe(false);
  });

  it('runs on the device when only a base URL is set', () => {
    expect(
      isProviderFetchOnClient('openai', { keyVaults: { baseURL: 'http://localhost:8000/v1' } }),
    ).toBe(true);
  });

  it('follows fetchOnClient with both a base URL and a key, default server', () => {
    const keyVaults = { apiKey: 'sk', baseURL: 'http://localhost:8000/v1' };
    expect(isProviderFetchOnClient('openai', { fetchOnClient: true, keyVaults })).toBe(true);
    expect(isProviderFetchOnClient('openai', { keyVaults })).toBe(false);
  });
});

describe('isProviderDeviceOnly', () => {
  it('relays a local provider unless fetchOnClient says otherwise', () => {
    expect(isProviderDeviceOnly('ollama', undefined)).toBe(true);
    expect(isProviderDeviceOnly('lmstudio', { keyVaults: {} })).toBe(true);
    expect(isProviderDeviceOnly('ollama', { fetchOnClient: false })).toBe(false);
  });

  it('relays a provider with only a base URL', () => {
    expect(
      isProviderDeviceOnly('openai', { keyVaults: { baseURL: 'http://192.168.1.2:8000/v1' } }),
    ).toBe(true);
  });

  it('relays a keyed provider on a private network only when fetchOnClient asks for it', () => {
    for (const baseURL of [
      'http://127.0.0.1:1234/v1',
      'http://localhost:8000/v1',
      'http://10.0.0.5/v1',
      'http://172.20.1.1/v1',
      'http://192.168.1.2:8000/v1',
      'http://[::1]:8000/v1',
      'http://[fd12:3456:789a::1]:8000/v1',
      'http://[fe80::1]:8000/v1',
      'http://[::ffff:127.0.0.1]:1234/v1',
      'http://[::ffff:c0a8:102]:8000/v1',
      'http://169.254.1.2:8000/v1',
      'http://100.101.102.103:11434/v1',
      'http://dev-box.local:8000/v1',
      'http://gpu.lan:8000/v1',
      'http://llm.internal/v1',
      'http://nas.home.arpa:8000/v1',
      'http://dev-box:8000/v1',
    ]) {
      const keyVaults = { apiKey: 'k', baseURL };
      expect(isProviderDeviceOnly('my-llm', { fetchOnClient: true, keyVaults })).toBe(true);
      // An unset flag keeps the server call, so one-shot relay setup and the
      // server agree on the same execution site.
      expect(isProviderDeviceOnly('my-llm', { fetchOnClient: false, keyVaults })).toBe(false);
      expect(isProviderDeviceOnly('my-llm', { keyVaults })).toBe(false);
    }

    for (const baseURL of [
      // Public IPv4 just outside the private ranges, a public IPv6 host and hostnames.
      'http://172.32.0.1/v1',
      'http://169.255.0.1/v1',
      'http://100.128.0.1/v1',
      'https://local.example.com/v1',
      'http://[2001:db8::1]:8000/v1',
      'https://api.example.com/v1',
    ]) {
      expect(
        isProviderDeviceOnly('my-llm', {
          fetchOnClient: true,
          keyVaults: { apiKey: 'k', baseURL },
        }),
      ).toBe(false);
    }
  });

  it('keeps a provider with an API key on the server even with fetchOnClient', () => {
    const keyVaults = { apiKey: 'sk-test', baseURL: 'https://api.example.com/v1' };
    expect(isProviderDeviceOnly('openai', { fetchOnClient: true, keyVaults })).toBe(false);
    expect(
      isProviderDeviceOnly('openai', { fetchOnClient: true, keyVaults: { apiKey: 'k' } }),
    ).toBe(false);
  });

  it('keeps a provider with neither on the server', () => {
    expect(isProviderDeviceOnly('openai', { fetchOnClient: true, keyVaults: {} })).toBe(false);
  });
});
