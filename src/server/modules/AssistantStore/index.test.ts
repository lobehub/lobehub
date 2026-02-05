// @vitest-environment node
import { EdgeConfig } from '@lobechat/edge-config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AssistantStore } from './index';

const baseURL = 'https://registry.npmmirror.com/@lobehub/agents-index/v1/files/public';

vi.mock('@lobechat/edge-config', () => {
  const EdgeConfigMock = vi.fn();
  // @ts-expect-error: static mock for isEnabled
  EdgeConfigMock.isEnabled = vi.fn();
  EdgeConfigMock.prototype.getAgentRestrictions = vi.fn();
  return { EdgeConfig: EdgeConfigMock };
});

describe('AssistantStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    // @ts-expect-error
    global.fetch = undefined;
  });

  it('should return the default index URL when no language is provided', () => {
    const agentMarket = new AssistantStore();
    const url = agentMarket['getAgentIndexUrl']();
    expect(url).toBe(`${baseURL}/index.en-US.json`);
  });

  it('should return the index URL for a not supported language', () => {
    const agentMarket = new AssistantStore();
    const url = agentMarket['getAgentIndexUrl']('xxx' as any);
    expect(url).toBe(baseURL);
  });

  it('should return the zh-CN URL for zh locale', () => {
    const agentMarket = new AssistantStore();
    const url = agentMarket['getAgentIndexUrl']('zh' as any);
    expect(url).toBe(`${baseURL}/index.zh-CN.json`);
  });

  it('should return the default URL for en locale', () => {
    const agentMarket = new AssistantStore();
    const url = agentMarket['getAgentIndexUrl']('en' as any);
    expect(url).toBe(`${baseURL}/index.en-US.json`);
  });

  it('should return the base URL if the provided language is not supported', () => {
    const agentMarket = new AssistantStore();
    const url = agentMarket['getAgentIndexUrl']('fr' as any);
    expect(url).toBe(baseURL);
  });

  it('should return the agent URL with default language when no language is provided', () => {
    const agentMarket = new AssistantStore();
    const url = agentMarket.getAgentUrl('agent-123');
    expect(url).toBe(`${baseURL}/agent-123.en-US.json`);
  });

  it('should return the agent URL for a supported language', () => {
    const agentMarket = new AssistantStore();
    const url = agentMarket.getAgentUrl('agent-123', 'zh-CN');
    expect(url).toBe(`${baseURL}/agent-123.zh-CN.json`);
  });

  it('should return the agent URL without language suffix if the provided language is not supported', () => {
    const agentMarket = new AssistantStore();
    const url = agentMarket.getAgentUrl('agent-123', 'fr' as any);
    expect(url).toBe(`${baseURL}/agent-123.json`);
  });

  it('should return empty agents array with schema version when fetch fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('fetch failed'));
    const store = new AssistantStore();
    const result = await store.getAgentIndex();
    expect(result).toEqual([]);
  });

  it('should handle fetch error and return empty agents with schema version when error.ok is false', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      text: () => Promise.resolve('Error'),
    });
    const store = new AssistantStore();
    const result = await store.getAgentIndex();
    expect(result).toEqual([]);
  });

  it('should filter agents by whitelist when EdgeConfig is enabled', async () => {
    const mockAgents = {
      agents: [
        { identifier: 'agent1', meta: {}, author: '', createAt: '', createdAt: '', homepage: '' },
        { identifier: 'agent2', meta: {}, author: '', createAt: '', createdAt: '', homepage: '' },
      ],
      schemaVersion: 1,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ...mockAgents }),
      clone: () => ({ json: () => Promise.resolve({ ...mockAgents }) }),
    });

    // @ts-expect-error
    EdgeConfig.isEnabled.mockReturnValue(true);

    const store = new AssistantStore();
    (EdgeConfig as any).prototype.getAgentRestrictions.mockResolvedValue({
      whitelist: ['agent1'],
      blacklist: undefined,
    });

    const result = await store.getAgentIndex();

    expect(result).toHaveLength(1);
    expect(result[0].identifier).toBe('agent1');
  });

  it('should filter agents by blacklist when EdgeConfig is enabled and no whitelist', async () => {
    const mockAgents = {
      agents: [
        { identifier: 'agent1', meta: {}, author: '', createAt: '', createdAt: '', homepage: '' },
        { identifier: 'agent2', meta: {}, author: '', createAt: '', createdAt: '', homepage: '' },
      ],
      schemaVersion: 1,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ...mockAgents }),
      clone: () => ({ json: () => Promise.resolve({ ...mockAgents }) }),
    });

    // @ts-expect-error
    EdgeConfig.isEnabled.mockReturnValue(true);

    const store = new AssistantStore();
    (EdgeConfig as any).prototype.getAgentRestrictions.mockResolvedValue({
      whitelist: undefined,
      blacklist: ['agent2'],
    });

    const result = await store.getAgentIndex();

    expect(result).toHaveLength(1);
    expect(result[0].identifier).toBe('agent1');
  });

  it('should fallback to default language if fetch returns 404', async () => {
    const mockAgents = {
      agents: [
        { identifier: 'agent1', meta: {}, author: '', createAt: '', createdAt: '', homepage: '' },
      ],
      schemaVersion: 1,
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: 404,
        ok: false,
        text: () => Promise.resolve('Not found'),
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: () => Promise.resolve({ ...mockAgents }),
        clone: () => ({ json: () => Promise.resolve({ ...mockAgents }) }),
      });

    global.fetch = fetchMock as any;

    // @ts-expect-error
    EdgeConfig.isEnabled.mockReturnValue(false);

    const store = new AssistantStore();
    const result = await store.getAgentIndex('zh-CN');
    expect(result).toEqual([
      { identifier: 'agent1', meta: {}, author: '', createAt: '', createdAt: '', homepage: '' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('should throw error for unexpected error in getAgentIndex', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('something else'));
    const store = new AssistantStore();

     
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(store.getAgentIndex()).rejects.toThrow('something else');
  });
});
