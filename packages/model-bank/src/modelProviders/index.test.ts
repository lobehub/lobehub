import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type ModelProviderCard } from '../types';
import {
  DEFAULT_MODEL_PROVIDER_LIST,
  getProviderDisplayName,
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
