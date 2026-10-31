import { CURRENT_VERSION, isDesktop } from '@lobechat/const';
import { type MarketSDK } from '@lobehub/market-sdk';

import { type TrustedClientUserInfo } from '@/libs/trusted-client';
import { AssistantStore } from '@/server/modules/AssistantStore';
import { PluginStore } from '@/server/modules/PluginStore';
import { MarketService } from '@/server/services/market';

import * as assistants from './assistants';
import * as groupAgents from './groupAgents';
import * as mcp from './mcp';
import * as models from './models';
import * as plugins from './plugins';
import * as providers from './providers';
import { getUserInfo } from './userProfile';
import { log } from './utils';

export interface DiscoverServiceOptions {
  /** Access token from OIDC flow (legacy) */
  accessToken?: string;
  /** User info for generating trusted client token */
  userInfo?: TrustedClientUserInfo;
}

export class DiscoverService {
  assistantStore = new AssistantStore();
  pluginStore = new PluginStore();
  market: MarketSDK;

  constructor(options: DiscoverServiceOptions = {}) {
    const { accessToken, userInfo } = options;

    // Use MarketService to initialize MarketSDK
    const marketService = new MarketService({ accessToken, userInfo });
    this.market = marketService.market;

    log(
      'DiscoverService initialized with market baseURL: %s, hasAuth: %s, userId: %s',
      process.env.MARKET_BASE_URL,
      !!(accessToken || userInfo),
      userInfo?.userId,
    );
  }

  async registerClient({ userAgent }: { userAgent?: string }) {
    const getDeviceId = async (): Promise<string> => {
      // 1. Use VERCEL_PROJECT_ID in Vercel environment
      if (process.env.VERCEL_PROJECT_ID) {
        return process.env.VERCEL_PROJECT_ID;
      }

      // 2. Use machine-id for desktop
      if (isDesktop) {
        try {
          // Dynamic import
          const { machineId } = await import('node-machine-id');
          return await machineId();
        } catch (error) {
          console.error('Failed to get machine-id:', error);
        }
      }

      return 'unknown-device';
    };

    const deviceId = await getDeviceId();

    const { client_id, client_secret } = await this.market.registerClient({
      clientName: `LobeHub ${isDesktop ? 'Desktop' : 'Web'}`,
      clientType: isDesktop ? 'desktop' : 'web',
      deviceId,
      platform: isDesktop ? process.platform : userAgent,
      version: CURRENT_VERSION,
    });

    return { clientId: client_id, clientSecret: client_secret };
  }

  async fetchM2MToken(params: { clientId: string; clientSecret: string }) {
    // Use MarketService with M2M credentials
    const marketService = new MarketService({
      clientCredentials: params,
    });

    const tokenInfo = await marketService.fetchM2MToken();

    return {
      accessToken: tokenInfo.accessToken,
      expiresIn: tokenInfo.expiresIn,
    };
  }

  // ============================== Call Cloud Mcp Endpoint Methods ==============================

  async callCloudMcpEndpoint(params: {
    apiParams: Record<string, any>;
    identifier: string;
    toolName: string;
    userAccessToken?: string;
  }) {
    log('callCloudMcpEndpoint: params=%O', {
      apiParams: params.apiParams,
      hasUserAccessToken: !!params.userAccessToken,
      identifier: params.identifier,
      toolName: params.toolName,
    });

    try {
      // Build headers - only include Authorization if userAccessToken is provided
      // When userAccessToken is not provided, MarketSDK will use trustedClientToken for authentication
      const headers: Record<string, string> = {};
      if (params.userAccessToken) {
        headers.Authorization = `Bearer ${params.userAccessToken}`;
      }

      // Call cloud gateway with optional user access token in Authorization header
      const result = await this.market.plugins.callCloudGateway(
        {
          apiParams: params.apiParams,
          identifier: params.identifier,
          toolName: params.toolName,
        },
        {
          headers,
        },
      );

      log('callCloudMcpEndpoint: success, result=%O', result);
      return result;
    } catch (error) {
      log('callCloudMcpEndpoint: error=%O', error);
      throw error;
    }
  }

  // ============================== Helper Methods ==============================

  /**
   * Calculate ModelAbilities completeness score
   * Higher score indicates more complete abilities
   */
  private calculateAbilitiesScore = models.calculateAbilitiesScore;

  /**
   * Select the model with the most complete abilities from model array
   * Combines the most complete abilities and largest contextWindowTokens
   */
  private selectModelWithBestAbilities = models.selectModelWithBestAbilities;

  // ============================== Assistant Market ==============================

  getAssistantCategories = assistants.getAssistantCategories.bind(null, this);
  getAssistantDetail = assistants.getAssistantDetail.bind(null, this);
  getAssistantIdentifiers = assistants.getAssistantIdentifiers.bind(null, this);
  getAssistantList = assistants.getAssistantList.bind(null, this);

  // ============================== MCP Market ==============================

  getMcpCategories = mcp.getMcpCategories.bind(null, this);
  getMcpDetail = mcp.getMcpDetail.bind(null, this);
  getMcpList = mcp.getMcpList.bind(null, this);
  getMcpManifest = mcp.getMcpManifest.bind(null, this);

  // ============================== MCP Analytics ==============================

  /**
   * report MCP plugin result marketplace
   */
  reportPluginInstallation = mcp.reportPluginInstallation.bind(null, this);

  /**
   * record Agent plugin event
   */
  createAgentEvent = mcp.createAgentEvent.bind(null, this);

  /**
   * record MCP plugin event
   */
  createPluginEvent = mcp.createPluginEvent.bind(null, this);

  /**
   * report plugin call result to marketplace
   */
  reportCall = mcp.reportCall.bind(null, this);

  // ============================== Agent Analytics ==============================

  /**
   * Increase agent install count in marketplace
   */
  increaseAgentInstallCount = mcp.increaseAgentInstallCount.bind(null, this);

  /**
   * Get agents that use a specific plugin
   */
  getAgentsByPlugin = assistants.getAgentsByPlugin.bind(null, this);

  // ============================== Plugin Market ==============================

  getLegacyPluginList = plugins.getLegacyPluginList.bind(null, this);
  getPluginCategories = plugins.getPluginCategories.bind(null, this);
  getPluginDetail = plugins.getPluginDetail.bind(null, this);
  getPluginIdentifiers = plugins.getPluginIdentifiers.bind(null, this);
  getPluginList = plugins.getPluginList.bind(null, this);

  // ============================== Providers ==============================

  getProviderDetail = providers.getProviderDetail.bind(null, this);
  getProviderIdentifiers = providers.getProviderIdentifiers;
  getProviderList = providers.getProviderList;

  // ============================== Models ==============================

  getModelCategories = models.getModelCategories;
  getModelDetail = models.getModelDetail.bind(null, this);
  getModelIdentifiers = models.getModelIdentifiers;
  getModelList = models.getModelList;

  // ============================== User Profile ==============================

  /**
   * Get user profile and their published agents by username
   */
  getUserInfo = getUserInfo.bind(null, this);

  // ============================== Group Agent Market Methods ==============================

  getGroupAgentCategories = groupAgents.getGroupAgentCategories.bind(null, this);
  getGroupAgentDetail = groupAgents.getGroupAgentDetail.bind(null, this);
  getGroupAgentIdentifiers = groupAgents.getGroupAgentIdentifiers.bind(null, this);
  getGroupAgentList = groupAgents.getGroupAgentList.bind(null, this);
  createGroupAgentEvent = groupAgents.createGroupAgentEvent.bind(null, this);
  increaseGroupAgentInstallCount = groupAgents.increaseGroupAgentInstallCount.bind(null, this);
}
