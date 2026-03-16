// @vitest-environment node
import { MarketSDK } from '@lobehub/market-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { generateTrustedClientToken, getTrustedClientTokenForSession } from '@/libs/trusted-client';

import { extractAccessToken, MarketService } from './index';

// Mock dependencies before importing the module under test
vi.mock('@lobehub/market-sdk', () => {
  const MarketSDK = vi.fn().mockImplementation(() => ({
    agentGroups: {
      getAgentGroupDetail: vi.fn(),
      getAgentGroupList: vi.fn(),
    },
    agents: {
      createEvent: vi.fn(),
      getAgentDetail: vi.fn(),
      getAgentList: vi.fn(),
      increaseInstallCount: vi.fn(),
    },
    auth: {
      exchangeOAuthToken: vi.fn(),
      getOAuthHandoff: vi.fn(),
      getUserInfo: vi.fn(),
    },
    connect: {
      listConnections: vi.fn(),
    },
    feedback: {
      submitFeedback: vi.fn(),
    },
    fetchM2MToken: vi.fn(),
    headers: {},
    marketSkills: {
      downloadSkill: vi.fn(),
      getCategories: vi.fn(),
      getDownloadUrl: vi.fn(),
      getSkillDetail: vi.fn(),
      getSkillList: vi.fn(),
    },
    plugins: {
      callCloudGateway: vi.fn(),
      createEvent: vi.fn(),
      getPluginManifest: vi.fn(),
      reportCall: vi.fn(),
      reportInstallation: vi.fn(),
      runBuildInTool: vi.fn(),
    },
    skills: {
      callTool: vi.fn(),
      listTools: vi.fn(),
    },
    user: {
      getUserInfo: vi.fn(),
      register: vi.fn(),
    },
  }));
  return { MarketSDK };
});

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn(),
  getTrustedClientTokenForSession: vi.fn(),
}));

vi.mock('debug', () => ({
  default: vi.fn(() => vi.fn()),
}));

describe('extractAccessToken', () => {
  it('should return undefined when no authorization header present', () => {
    const req = { headers: { get: vi.fn().mockReturnValue(null) } } as any;
    expect(extractAccessToken(req)).toBeUndefined();
  });

  it('should return undefined when auth header does not start with Bearer', () => {
    const req = {
      headers: { get: vi.fn().mockReturnValue('Basic abc123') },
    } as any;
    expect(extractAccessToken(req)).toBeUndefined();
  });

  it('should return the token when auth header starts with Bearer', () => {
    const token = 'my-access-token';
    const req = {
      headers: { get: vi.fn().mockReturnValue(`Bearer ${token}`) },
    } as any;
    expect(extractAccessToken(req)).toBe(token);
  });

  it('should return empty string for "Bearer " with no token', () => {
    const req = {
      headers: { get: vi.fn().mockReturnValue('Bearer ') },
    } as any;
    expect(extractAccessToken(req)).toBe('');
  });
});

describe('MarketService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create MarketSDK with no options by default', () => {
      new MarketService();
      expect(MarketSDK).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: undefined,
          trustedClientToken: undefined,
        }),
      );
    });

    it('should pass accessToken to MarketSDK', () => {
      new MarketService({ accessToken: 'my-token' });
      expect(MarketSDK).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'my-token' }));
    });

    it('should use provided trustedClientToken directly', () => {
      new MarketService({ trustedClientToken: 'pre-generated-token' });
      expect(MarketSDK).toHaveBeenCalledWith(
        expect.objectContaining({ trustedClientToken: 'pre-generated-token' }),
      );
    });

    it('should generate trustedClientToken from userInfo when no trustedClientToken', () => {
      const userInfo = { userId: 'user-1' } as any;
      (generateTrustedClientToken as any).mockReturnValue('generated-token');

      new MarketService({ userInfo });

      expect(generateTrustedClientToken).toHaveBeenCalledWith(userInfo);
      expect(MarketSDK).toHaveBeenCalledWith(
        expect.objectContaining({ trustedClientToken: 'generated-token' }),
      );
    });

    it('should prefer trustedClientToken over generating from userInfo', () => {
      const userInfo = { userId: 'user-1' } as any;

      new MarketService({ trustedClientToken: 'explicit-token', userInfo });

      expect(generateTrustedClientToken).not.toHaveBeenCalled();
      expect(MarketSDK).toHaveBeenCalledWith(
        expect.objectContaining({ trustedClientToken: 'explicit-token' }),
      );
    });

    it('should pass clientCredentials to MarketSDK', () => {
      new MarketService({
        clientCredentials: { clientId: 'client-id', clientSecret: 'client-secret' },
      });
      expect(MarketSDK).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'client-id',
          clientSecret: 'client-secret',
        }),
      );
    });
  });

  describe('createFromRequest', () => {
    it('should extract access token from request and get session trusted token', async () => {
      const req = {
        headers: { get: vi.fn().mockReturnValue('Bearer session-token') },
      } as any;
      (getTrustedClientTokenForSession as any).mockResolvedValue('session-trusted-token');

      const service = await MarketService.createFromRequest(req);

      expect(service).toBeInstanceOf(MarketService);
      expect(MarketSDK).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: 'session-token',
          trustedClientToken: 'session-trusted-token',
        }),
      );
    });

    it('should work without an authorization header', async () => {
      const req = {
        headers: { get: vi.fn().mockReturnValue(null) },
      } as any;
      (getTrustedClientTokenForSession as any).mockResolvedValue(undefined);

      const service = await MarketService.createFromRequest(req);
      expect(service).toBeInstanceOf(MarketService);
    });
  });

  describe('submitFeedback', () => {
    it('should pass params to market SDK without screenshot', async () => {
      const service = new MarketService();
      const mockSubmitFeedback = vi.fn().mockResolvedValue({ success: true });
      (service as any).market.feedback.submitFeedback = mockSubmitFeedback;

      await service.submitFeedback({
        message: 'Great app!',
        title: 'Feedback',
      });

      expect(mockSubmitFeedback).toHaveBeenCalledWith({
        clientInfo: undefined,
        email: '',
        message: 'Great app!',
        title: 'Feedback',
      });
    });

    it('should append screenshot URL to message when provided', async () => {
      const service = new MarketService();
      const mockSubmitFeedback = vi.fn().mockResolvedValue({ success: true });
      (service as any).market.feedback.submitFeedback = mockSubmitFeedback;

      await service.submitFeedback({
        message: 'Bug found',
        screenshotUrl: 'https://example.com/screenshot.png',
        title: 'Bug Report',
      });

      expect(mockSubmitFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Bug found\n\n**Screenshot**: https://example.com/screenshot.png',
        }),
      );
    });

    it('should pass email and clientInfo when provided', async () => {
      const service = new MarketService();
      const mockSubmitFeedback = vi.fn().mockResolvedValue({ success: true });
      (service as any).market.feedback.submitFeedback = mockSubmitFeedback;

      await service.submitFeedback({
        clientInfo: { language: 'en', userAgent: 'Chrome' },
        email: 'user@example.com',
        message: 'Hello',
        title: 'Test',
      });

      expect(mockSubmitFeedback).toHaveBeenCalledWith({
        clientInfo: { language: 'en', userAgent: 'Chrome' },
        email: 'user@example.com',
        message: 'Hello',
        title: 'Test',
      });
    });
  });

  describe('executeLobehubSkill', () => {
    it('should return success result with string content', async () => {
      const service = new MarketService();
      const mockCallTool = vi.fn().mockResolvedValue({ data: 'tool result', success: true });
      (service as any).market.skills.callTool = mockCallTool;

      const result = await service.executeLobehubSkill({
        args: { query: 'test' },
        provider: 'my-provider',
        toolName: 'search',
      });

      expect(mockCallTool).toHaveBeenCalledWith('my-provider', {
        args: { query: 'test' },
        tool: 'search',
      });
      expect(result).toEqual({ content: 'tool result', success: true });
    });

    it('should serialize non-string data to JSON', async () => {
      const service = new MarketService();
      const responseData = { items: ['a', 'b'] };
      const mockCallTool = vi.fn().mockResolvedValue({ data: responseData, success: true });
      (service as any).market.skills.callTool = mockCallTool;

      const result = await service.executeLobehubSkill({
        args: {},
        provider: 'provider',
        toolName: 'listItems',
      });

      expect(result.content).toBe(JSON.stringify(responseData));
      expect(result.success).toBe(true);
    });

    it('should return error result when an exception is thrown', async () => {
      const service = new MarketService();
      const mockCallTool = vi.fn().mockRejectedValue(new Error('Network error'));
      (service as any).market.skills.callTool = mockCallTool;

      const result = await service.executeLobehubSkill({
        args: {},
        provider: 'provider',
        toolName: 'failTool',
      });

      expect(result).toEqual({
        content: 'Network error',
        error: { code: 'LOBEHUB_SKILL_ERROR', message: 'Network error' },
        success: false,
      });
    });
  });

  describe('getLobehubSkillManifests', () => {
    it('should return empty array when no connections', async () => {
      const service = new MarketService();
      (service as any).market.connect.listConnections = vi
        .fn()
        .mockResolvedValue({ connections: [] });

      const result = await service.getLobehubSkillManifests();
      expect(result).toEqual([]);
    });

    it('should return empty array when connections is null/undefined', async () => {
      const service = new MarketService();
      (service as any).market.connect.listConnections = vi
        .fn()
        .mockResolvedValue({ connections: null });

      const result = await service.getLobehubSkillManifests();
      expect(result).toEqual([]);
    });

    it('should build manifests for each connected skill', async () => {
      const service = new MarketService();
      (service as any).market.connect.listConnections = vi.fn().mockResolvedValue({
        connections: [
          { icon: '🐦', providerId: 'twitter', providerName: 'Twitter' },
          { icon: '📋', providerId: 'linear', providerName: 'Linear' },
        ],
      });
      (service as any).market.skills.listTools = vi
        .fn()
        .mockImplementation((providerId: string) => {
          if (providerId === 'twitter') {
            return Promise.resolve({
              tools: [
                {
                  description: 'Post a tweet',
                  inputSchema: { properties: { text: { type: 'string' } }, type: 'object' },
                  name: 'postTweet',
                },
              ],
            });
          }
          return Promise.resolve({
            tools: [
              {
                description: 'Create issue',
                inputSchema: { properties: { title: { type: 'string' } }, type: 'object' },
                name: 'createIssue',
              },
            ],
          });
        });

      const manifests = await service.getLobehubSkillManifests();

      expect(manifests).toHaveLength(2);
      expect(manifests[0]).toEqual({
        api: [
          {
            description: 'Post a tweet',
            name: 'postTweet',
            parameters: { properties: { text: { type: 'string' } }, type: 'object' },
          },
        ],
        identifier: 'twitter',
        meta: {
          avatar: '🐦',
          description: 'LobeHub Skill: Twitter',
          tags: ['lobehub-skill', 'twitter'],
          title: 'Twitter',
        },
        type: 'builtin',
      });
    });

    it('should skip connections without providerId', async () => {
      const service = new MarketService();
      (service as any).market.connect.listConnections = vi.fn().mockResolvedValue({
        connections: [
          { icon: '🔗' }, // no providerId
          { icon: '📋', providerId: 'linear', providerName: 'Linear' },
        ],
      });
      (service as any).market.skills.listTools = vi.fn().mockResolvedValue({
        tools: [{ description: 'Create', inputSchema: {}, name: 'create' }],
      });

      const manifests = await service.getLobehubSkillManifests();
      expect(manifests).toHaveLength(1);
      expect(manifests[0].identifier).toBe('linear');
    });

    it('should skip connections where listTools returns empty', async () => {
      const service = new MarketService();
      (service as any).market.connect.listConnections = vi.fn().mockResolvedValue({
        connections: [{ icon: '🔗', providerId: 'emptyProvider', providerName: 'Empty' }],
      });
      (service as any).market.skills.listTools = vi.fn().mockResolvedValue({ tools: [] });

      const manifests = await service.getLobehubSkillManifests();
      expect(manifests).toEqual([]);
    });

    it('should use default avatar when icon is not provided', async () => {
      const service = new MarketService();
      (service as any).market.connect.listConnections = vi.fn().mockResolvedValue({
        connections: [{ providerId: 'noIcon', providerName: 'No Icon' }],
      });
      (service as any).market.skills.listTools = vi.fn().mockResolvedValue({
        tools: [{ description: 'Do', inputSchema: {}, name: 'doThing' }],
      });

      const manifests = await service.getLobehubSkillManifests();
      expect(manifests[0].meta.avatar).toBe('🔗');
    });

    it('should return empty array when listConnections throws', async () => {
      const service = new MarketService();
      (service as any).market.connect.listConnections = vi
        .fn()
        .mockRejectedValue(new Error('Network error'));

      const manifests = await service.getLobehubSkillManifests();
      expect(manifests).toEqual([]);
    });

    it('should continue building other manifests when one connection fails', async () => {
      const service = new MarketService();
      (service as any).market.connect.listConnections = vi.fn().mockResolvedValue({
        connections: [
          { providerId: 'failing', providerName: 'Failing' },
          { providerId: 'working', providerName: 'Working' },
        ],
      });
      (service as any).market.skills.listTools = vi.fn().mockImplementation((id: string) => {
        if (id === 'failing') return Promise.reject(new Error('Failed'));
        return Promise.resolve({
          tools: [{ description: 'Work', inputSchema: {}, name: 'work' }],
        });
      });

      const manifests = await service.getLobehubSkillManifests();
      expect(manifests).toHaveLength(1);
      expect(manifests[0].identifier).toBe('working');
    });
  });

  describe('getSDK', () => {
    it('should return the underlying MarketSDK instance', () => {
      const service = new MarketService();
      const sdk = service.getSDK();
      expect(sdk).toBe((service as any).market);
    });
  });
});
