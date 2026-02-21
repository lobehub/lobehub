import { type LobeToolManifest } from '@lobechat/context-engine';
import { MarketSDK } from '@lobehub/market-sdk';
import debug from 'debug';
import { type NextRequest } from 'next/server';

import { type TrustedClientUserInfo } from '@/libs/trusted-client';
import { generateTrustedClientToken, getTrustedClientTokenForSession } from '@/libs/trusted-client';

const log = debug('lobe-server:market-service');

const MARKET_BASE_URL = process.env.NEXT_PUBLIC_MARKET_BASE_URL || 'https://market.lobehub.com';

// ============================== Helper Functions ==============================

/**
 * Extract access token from Authorization header
 */
export function extractAccessToken(req: NextRequest): string | undefined {
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return undefined;
}

export interface LobehubSkillExecuteParams {
  args: Record<string, any>;
  provider: string;
  toolName: string;
}

export interface LobehubSkillExecuteResult {
  content: string;
  error?: { code: string; message?: string };
  success: boolean;
}

export interface MarketServiceOptions {
  /** Access token from OIDC flow (user token) */
  accessToken?: string;
  /** Client credentials for M2M authentication */
  clientCredentials?: {
    clientId: string;
    clientSecret: string;
  };
  /** Pre-generated trusted client token (alternative to userInfo) */
  trustedClientToken?: string;
  /** User info for generating trusted client token */
  userInfo?: TrustedClientUserInfo;
}

/**
 * Market Service
 *
 * Provides a unified interface to MarketSDK with business logic encapsulation.
 * This service wraps MarketSDK methods to avoid repetition across the codebase.
 *
 * Usage:
 * ```typescript
 * // From Next.js request (API Routes) - recommended
 * const marketService = await MarketService.createFromRequest(req);
 * await marketService.submitFeedback({ ... });
 *
 * // With user authentication
 * const service = new MarketService({ accessToken, userInfo });
 *
 * // With trusted client only
 * const service = new MarketService({ userInfo });
 *
 * // M2M authentication
 * const service = new MarketService({ clientCredentials: { clientId, clientSecret } });
 *
 * // Public endpoints (no auth)
 * const service = new MarketService();
 * ```
 */
export class MarketService {
  market: MarketSDK;

  constructor(options: MarketServiceOptions = {}) {
    const { accessToken, userInfo, clientCredentials, trustedClientToken } = options;

    // Use provided trustedClientToken or generate from userInfo
    const resolvedTrustedClientToken =
      trustedClientToken || (userInfo ? generateTrustedClientToken(userInfo) : undefined);

    this.market = new MarketSDK({
      accessToken,
      baseURL: MARKET_BASE_URL,
      clientId: clientCredentials?.clientId,
      clientSecret: clientCredentials?.clientSecret,
      trustedClientToken: resolvedTrustedClientToken,
    });

    log(
      'MarketService initialized: baseURL=%s, hasAccessToken=%s, hasTrustedToken=%s, hasClientCredentials=%s',
      MARKET_BASE_URL,
      !!accessToken,
      !!resolvedTrustedClientToken,
      !!clientCredentials,
    );
  }

  // ============================== Factory Methods ==============================

  /**
   * Create MarketService from Next.js request (server-side only)
   * Extracts accessToken from Authorization header and trustedClientToken from session
   */
  static async createFromRequest(req: NextRequest): Promise<MarketService> {
    const accessToken = extractAccessToken(req);
    const trustedClientToken = await getTrustedClientTokenForSession();

    return new MarketService({
      accessToken,
      trustedClientToken,
    });
  }

  // ============================== Feedback Methods ==============================

  /**
   * Submit feedback to LobeHub
   */
  async submitFeedback(params: {
    clientInfo?: {
      language?: string;
      timezone?: string;
      url?: string;
      userAgent?: string;
    };
    email?: string;
    message: string;
    screenshotUrl?: string;
    title: string;
  }) {
    const { title, message, email, screenshotUrl, clientInfo } = params;

    // Build message with screenshot if available
    let feedbackMessage = message;
    if (screenshotUrl) {
      feedbackMessage += `\n\n**Screenshot**: ${screenshotUrl}`;
    }

    return this.market.feedback.submitFeedback({
      clientInfo,
      email: email || '',
      message: feedbackMessage,
      title,
    });
  }

  // ============================== Auth Methods ==============================

  /**
   * Exchange OAuth authorization code for tokens
   */
  async exchangeAuthorizationCode(params: {
    clientId: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }) {
    return this.market.auth.exchangeOAuthToken({
      clientId: params.clientId,
      code: params.code,
      codeVerifier: params.codeVerifier,
      grantType: 'authorization_code',
      redirectUri: params.redirectUri,
    });
  }

  /**
   * Get OAuth handoff information
   */
  async getOAuthHandoff(id: string) {
    return this.market.auth.getOAuthHandoff(id);
  }

  /**
   * Get user info from token
   */
  async getUserInfo(token: string) {
    return this.market.auth.getUserInfo(token);
  }

  /**
   * Get user info with trusted client token (server-side)
   */
  async getUserInfoWithTrustedClient() {
    const userInfoUrl = `${MARKET_BASE_URL}/lobehub-oidc/userinfo`;
    const response = await fetch(userInfoUrl, {
      // @ts-ignore
      headers: this.market.headers,
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error('Failed to get user info');
    }

    return response.json();
  }

  /**
   * Refresh OAuth token
   */
  async refreshToken(params: { clientId: string; refreshToken: string }) {
    return this.market.auth.exchangeOAuthToken({
      clientId: params.clientId,
      grantType: 'refresh_token',
      refreshToken: params.refreshToken,
    });
  }

  // ============================== Client Methods ==============================

  /**
   * Register client for M2M authentication
   */
  async registerClient(params: {
    clientName: string;
    clientType: string;
    deviceId: string;
    platform?: string;
    version?: string;
  }) {
    // @ts-ignore
    return this.market.registerClient(params);
  }

  /**
   * Fetch M2M token with client credentials
   */
  async fetchM2MToken() {
    return this.market.fetchM2MToken();
  }

  // ============================== Skills Methods ==============================

  /**
   * List available tools for a provider
   */
  async listSkillTools(providerId: string) {
    return this.market.skills.listTools(providerId);
  }

  /**
   * Call a skill tool
   */
  async callSkillTool(provider: string, params: { args: Record<string, any>; tool: string }) {
    return this.market.skills.callTool(provider, params);
  }

  /**
   * List user's connected skills
   */
  async listSkillConnections() {
    return this.market.connect.listConnections();
  }

  // ============================== Plugin Methods ==============================

  /**
   * Call cloud MCP endpoint
   */
  async callCloudMcpEndpoint(
    params: {
      apiParams: Record<string, any>;
      identifier: string;
      toolName: string;
    },
    options?: {
      headers?: Record<string, string>;
    },
  ) {
    return this.market.plugins.callCloudGateway(params, options);
  }

  /**
   * Export file from sandbox to upload URL
   */
  async exportFile(params: { path: string; topicId: string; uploadUrl: string; userId: string }) {
    const { path, uploadUrl, topicId, userId } = params;

    return this.market.plugins.runBuildInTool(
      'exportFile',
      { path, uploadUrl },
      { topicId, userId },
    );
  }

  /**
   * Get plugin manifest
   */
  async getPluginManifest(params: {
    identifier: string;
    install?: boolean;
    locale?: string;
    version?: string;
  }) {
    return this.market.plugins.getPluginManifest(params);
  }

  /**
   * Report plugin installation
   */
  async reportPluginInstallation(params: any) {
    return this.market.plugins.reportInstallation(params);
  }

  /**
   * Report plugin call
   */
  async reportPluginCall(params: any) {
    return this.market.plugins.reportCall(params);
  }

  /**
   * Create plugin event
   */
  async createPluginEvent(params: any) {
    return this.market.plugins.createEvent(params);
  }

  // ============================== Agent Methods ==============================

  /**
   * Get agent detail
   */
  async getAgentDetail(identifier: string, options?: { locale?: string; version?: string }) {
    return this.market.agents.getAgentDetail(identifier, options);
  }

  /**
   * Get agent list
   */
  async getAgentList(params?: any) {
    return this.market.agents.getAgentList(params);
  }

  /**
   * Increase agent install count
   */
  async increaseAgentInstallCount(identifier: string) {
    return this.market.agents.increaseInstallCount(identifier);
  }

  /**
   * Create agent event
   */
  async createAgentEvent(params: any) {
    return this.market.agents.createEvent(params);
  }

  // ============================== Agent Group Methods ==============================

  /**
   * Get agent group detail
   */
  async getAgentGroupDetail(identifier: string, options?: { locale?: string; version?: number }) {
    return this.market.agentGroups.getAgentGroupDetail(identifier, options);
  }

  /**
   * Get agent group list
   */
  async getAgentGroupList(params?: any) {
    return this.market.agentGroups.getAgentGroupList(params);
  }

  // ============================== User Methods ==============================

  /**
   * Get user profile by username
   */
  async getUserProfile(username: string, options?: { locale?: string }) {
    return this.market.user.getUserInfo(username, options);
  }

  /**
   * Register user on market and optionally follow another user
   */
  async registerUser(params: { followUserId?: string; registerUserId: string }): Promise<void> {
    await this.market.user.register(params);
  }

  // ============================== Skills Methods ==============================

  /**
   * Execute a LobeHub Skill tool
   * @param params - The skill execution parameters (provider, toolName, args)
   * @returns Execution result with content and success status
   */
  async executeLobehubSkill(params: LobehubSkillExecuteParams): Promise<LobehubSkillExecuteResult> {
    const { provider, toolName, args } = params;

    log('executeLobehubSkill: %s/%s with args: %O', provider, toolName, args);

    try {
      const response = await this.market.skills.callTool(provider, {
        args,
        tool: toolName,
      });

      log('executeLobehubSkill: response: %O', response);

      return {
        content: typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
        success: response.success,
      };
    } catch (error) {
      const err = error as Error;
      console.error('MarketService.executeLobehubSkill error %s/%s: %O', provider, toolName, err);

      return {
        content: err.message,
        error: { code: 'LOBEHUB_SKILL_ERROR', message: err.message },
        success: false,
      };
    }
  }

  /**
   * Fetch LobeHub Skills manifests from Market API
   * Gets user's connected skills and builds tool manifests for agent execution
   *
   * @returns Array of tool manifests for connected skills
   */
  async getLobehubSkillManifests(): Promise<LobeToolManifest[]> {
    try {
      // 1. Get user's connected skills
      const { connections } = await this.market.connect.listConnections();
      if (!connections || connections.length === 0) {
        log('getLobehubSkillManifests: no connected skills found');
        return [];
      }

      log('getLobehubSkillManifests: found %d connected skills', connections.length);

      // 2. Fetch tools for each connection and build manifests
      const manifests: LobeToolManifest[] = [];

      for (const connection of connections) {
        try {
          // Connection returns providerId (e.g., 'twitter', 'linear'), not numeric id
          const providerId = (connection as any).providerId;
          if (!providerId) {
            log('getLobehubSkillManifests: connection missing providerId: %O', connection);
            continue;
          }
          const providerName =
            (connection as any).providerName || (connection as any).name || providerId;
          const icon = (connection as any).icon;

          const { tools } = await this.market.skills.listTools(providerId);
          if (!tools || tools.length === 0) continue;

          const manifest: LobeToolManifest = {
            api: tools.map((tool: any) => ({
              description: tool.description || '',
              name: tool.name,
              parameters: tool.inputSchema || { properties: {}, type: 'object' },
            })),
            identifier: providerId,
            meta: {
              avatar: icon || '🔗',
              description: `LobeHub Skill: ${providerName}`,
              tags: ['lobehub-skill', providerId],
              title: providerName,
            },
            type: 'builtin',
          };

          manifests.push(manifest);
          log(
            'getLobehubSkillManifests: built manifest for %s with %d tools',
            providerId,
            tools.length,
          );
        } catch (error) {
          log('getLobehubSkillManifests: failed to fetch tools for connection: %O', error);
        }
      }

      return manifests;
    } catch (error) {
      log('getLobehubSkillManifests: error fetching skills: %O', error);
      return [];
    }
  }

  // ============================== Direct SDK Access ==============================

  /**
   * Get MarketSDK instance for advanced usage
   * Use this when you need direct access to SDK methods not wrapped by this service
   */
  getSDK(): MarketSDK {
    return this.market;
  }
}
