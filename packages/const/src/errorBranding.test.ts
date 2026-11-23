import type * as BusinessConstModule from '@lobechat/business-const';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getProviderDisplayIdentifier,
  isBrandedProviderId,
  sanitizeBrandErrorText,
  sanitizeErrorPayloadForDisplay,
  toRuntimeProviderId,
} from './errorBranding';

const brand = vi.hoisted(() => ({
  cloud: 'Acme Work Cloud',
  name: 'Acme Work',
  provider: 'lobehub',
  providerDisplayId: 'managed-upstream',
}));

vi.mock('@lobechat/business-const', async (importOriginal) => ({
  ...(await importOriginal<typeof BusinessConstModule>()),
  get BRANDING_NAME() {
    return brand.name;
  },
  get BRANDING_PROVIDER() {
    return brand.provider;
  },
  get BRANDING_PROVIDER_DISPLAY_ID() {
    return brand.providerDisplayId;
  },
  get LOBE_CHAT_CLOUD() {
    return brand.cloud;
  },
}));

afterEach(() => {
  brand.cloud = 'Acme Work Cloud';
  brand.name = 'Acme Work';
  brand.provider = 'lobehub';
  brand.providerDisplayId = 'managed-upstream';
});

describe('errorBranding', () => {
  it('rewrites the default provider to BRANDING_PROVIDER_DISPLAY_ID while keeping custom providers', () => {
    expect(getProviderDisplayIdentifier('lobehub')).toBe('managed-upstream');
    expect(getProviderDisplayIdentifier('LobeHub')).toBe('managed-upstream');
    expect(getProviderDisplayIdentifier('openai')).toBe('openai');
    expect(getProviderDisplayIdentifier('custom-gateway')).toBe('custom-gateway');

    expect(isBrandedProviderId('lobehub')).toBe(true);
    expect(isBrandedProviderId('managed-upstream')).toBe(true);
    expect(isBrandedProviderId('openai')).toBe(false);

    expect(toRuntimeProviderId('managed-upstream')).toBe('lobehub');
    expect(toRuntimeProviderId('lobehub')).toBe('lobehub');
    expect(toRuntimeProviderId('openai')).toBe('openai');
  });

  it('falls back to BRANDING_NAME when custom-branded without BRANDING_PROVIDER_DISPLAY_ID', () => {
    brand.name = 'Acme Work';
    brand.providerDisplayId = '';

    expect(getProviderDisplayIdentifier('lobehub')).toBe('Acme Work');
    expect(sanitizeErrorPayloadForDisplay({ provider: 'lobehub' })).toEqual({
      provider: 'Acme Work',
    });
  });

  it('is a no-op under default LobeHub branding', () => {
    brand.cloud = 'LobeHub Cloud';
    brand.name = 'LobeHub';
    brand.providerDisplayId = '';

    const payload = {
      lobehub_trace: 'trace-1',
      message: 'LobeHub upstream rejected request',
      provider: 'lobehub',
    };

    expect(getProviderDisplayIdentifier('lobehub')).toBe('lobehub');
    expect(sanitizeBrandErrorText(payload.message)).toBe(payload.message);
    expect(sanitizeErrorPayloadForDisplay(payload)).toBe(payload);
  });

  it('drops upstream lobehub keys, rewrites default provider fields, and brands text', () => {
    const input = {
      'code': 'request_rejected',
      'diagnostics': {
        cost: 0.12,
        lobehub_node: 'edge-1',
        provider: 'lobehub',
        providerId: 'lobehub',
      },
      'lobehub_request_id': 'req-1',
      'message': 'IP 1.2.3.4 blocked by LobeHub Cloud (lobehub proxy / LobeChat)',
      'provider': 'lobehub',
      'type': 'ai_hub_error',
      'x-lobehub-channel': 'ch-1',
    };

    expect(sanitizeErrorPayloadForDisplay(input)).toEqual({
      code: 'request_rejected',
      diagnostics: {
        cost: 0.12,
        provider: 'managed-upstream',
        providerId: 'managed-upstream',
      },
      message: 'IP 1.2.3.4 blocked by Acme Work Cloud (Acme Work proxy / Acme Work)',
      provider: 'managed-upstream',
      type: 'ai_hub_error',
    });
  });

  it('preserves third-party and future custom providers untouched', () => {
    const input = {
      code: 'rate_limit',
      message: 'Too many requests',
      provider: 'custom-enterprise-llm',
    };

    expect(sanitizeErrorPayloadForDisplay(input)).toEqual(input);
  });

  it('sanitizes nested JSON-stringified payloads such as gateway detail fields', () => {
    const input = {
      detail: JSON.stringify({
        error: 'LobeHub rejected',
        lobehub_meta: { node: 'a' },
        provider: 'lobehub',
      }),
      provider: 'lobehub',
    };

    expect(sanitizeErrorPayloadForDisplay(input)).toEqual({
      detail: JSON.stringify({
        error: 'Acme Work rejected',
        provider: 'managed-upstream',
      }),
      provider: 'managed-upstream',
    });
  });

  it('handles circular references and arrays without throwing', () => {
    const cyclic: Record<string, unknown> = {
      items: [{ lobehubKey: 'secret', provider: 'lobehub' }],
      provider: 'lobehub',
    };
    cyclic.self = cyclic;

    expect(sanitizeErrorPayloadForDisplay(cyclic)).toEqual({
      items: [{ provider: 'managed-upstream' }],
      provider: 'managed-upstream',
      self: undefined,
    });
  });
});
