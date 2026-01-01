import { describe, expect, it } from 'vitest';

import { API_ENDPOINTS } from '../_url';

describe('API_ENDPOINTS', () => {
  it('should return correct basePath URLs', () => {
    expect(API_ENDPOINTS.oauth).toBe('/api/auth');
    expect(API_ENDPOINTS.proxy).toBe('/webapi/proxy');
    expect(API_ENDPOINTS.gateway).toBe('/webapi/plugin/gateway');
    expect(API_ENDPOINTS.trace).toBe('/webapi/trace');
    expect(API_ENDPOINTS.stt).toBe('/webapi/stt/openai');
    expect(API_ENDPOINTS.edge).toBe('/webapi/tts/edge');
    expect(API_ENDPOINTS.microsoft).toBe('/webapi/tts/microsoft');
  });

  it('should return correct dynamic URLs', () => {
    expect(API_ENDPOINTS.chat('openai')).toBe('/webapi/chat/openai');
    expect(API_ENDPOINTS.models('anthropic')).toBe('/webapi/models/anthropic');
    expect(API_ENDPOINTS.modelPull('azure')).toBe('/webapi/models/azure/pull');
    expect(API_ENDPOINTS.images('dalle')).toBe('/webapi/text-to-image/dalle');
    expect(API_ENDPOINTS.tts('openai')).toBe('/webapi/tts/openai');
  });
});
