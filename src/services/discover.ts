import {
  type CategoryItem,
  type CategoryListQuery,
  type PluginManifest,
} from '@lobehub/market-sdk';
import {
  type AgentEventRequest,
  type CallReportRequest,
  type InstallReportRequest,
  type PluginEventRequest,
} from '@lobehub/market-types';

import { lambdaClient } from '@/libs/trpc/client';
import { globalHelpers } from '@/store/global/helpers';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';
import {
  type AssistantListResponse,
  type AssistantMarketSource,
  type AssistantQueryParams,
  type DiscoverAssistantDetail,
  type DiscoverMcpDetail,
  type DiscoverModelDetail,
  type DiscoverPluginDetail,
  type DiscoverProviderDetail,
  type DiscoverUserProfile,
  type GroupAgentQueryParams,
  type IdentifiersResponse,
  type McpListResponse,
  type McpQueryParams,
  type ModelListResponse,
  type ModelQueryParams,
  type PluginListResponse,
  type PluginQueryParams,
  type ProviderListResponse,
  type ProviderQueryParams,
} from '@/types/discover';
import { type MCPPluginListParams } from '@/types/plugins';
import { cleanObject } from '@/utils/object';

class DiscoverService {
  private _isRetrying = false;

  // ============================== Assistant Market ==============================
  getAssistantCategories = async (
    params: CategoryListQuery & { source?: AssistantMarketSource } = {},
  ): Promise<CategoryItem[]> => {
    const locale = globalHelpers.getCurrentLanguage();
    const { source, ...rest } = params;
    return lambdaClient.market.getAssistantCategories.query({
      ...rest,
      locale,
      source,
    });
  };

  getAssistantDetail = async (params: {
    identifier: string;
    locale?: string;
    source?: AssistantMarketSource;
    version?: string;
  }): Promise<DiscoverAssistantDetail | undefined> => {
    const locale = globalHelpers.getCurrentLanguage();
    return lambdaClient.market.getAssistantDetail.query({
      identifier: params.identifier,
      locale,
      source: params.source,
      version: params.version,
    });
  };

  getAssistantIdentifiers = async (
    params: { source?: AssistantMarketSource } = {},
  ): Promise<IdentifiersResponse> => {
    return lambdaClient.market.getAssistantIdentifiers.query(params);
  };

  getAssistantList = async (params: AssistantQueryParams = {}): Promise<AssistantListResponse> => {
    const locale = globalHelpers.getCurrentLanguage();
    return lambdaClient.market.getAssistantList.query(
      {
        ...params,
        locale,
        page: params.page ? Number(params.page) : 1,
        pageSize: params.pageSize ? Number(params.pageSize) : 20,
      },
      { context: { showNotification: false } },
    );
  };

  getAgentsByPlugin = async (params: {
    locale?: string;
    page?: number;
    pageSize?: number;
    pluginId: string;
  }): Promise<AssistantListResponse> => {
    const locale = globalHelpers.getCurrentLanguage();
    return lambdaClient.market.getAgentsByPlugin.query({
      ...params,
      locale,
      page: params.page ? Number(params.page) : 1,
      pageSize: params.pageSize ? Number(params.pageSize) : 20,
    });
  };

  // ============================== MCP Market ==============================

  getMcpCategories = async (params: CategoryListQuery = {}): Promise<CategoryItem[]> => {
    const locale = globalHelpers.getCurrentLanguage();
    return lambdaClient.market.getMcpCategories.query({
      ...params,
      locale,
    });
  };

  getMcpDetail = async (params: {
    identifier: string;
    locale?: string;
    version?: string;
  }): Promise<DiscoverMcpDetail> => {
    const locale = globalHelpers.getCurrentLanguage();
    return lambdaClient.market.getMcpDetail.query({
      ...params,
      locale,
    });
  };

  getMcpList = async (params: McpQueryParams = {}): Promise<McpListResponse> => {
    const locale = globalHelpers.getCurrentLanguage();
    return lambdaClient.market.getMcpList.query({
      ...params,
      locale,
      page: params.page ? Number(params.page) : 1,
      pageSize: params.pageSize ? Number(params.pageSize) : 20,
    });
  };

  getMCPPluginList = async (params: MCPPluginListParams): Promise<McpListResponse> => {
    await this.injectMPToken();

    const locale = globalHelpers.getCurrentLanguage();

    return lambdaClient.market.getMcpList.query({
      ...params,
      locale,
      page: params.page ? Number(params.page) : 1,
      pageSize: params.pageSize ? Number(params.pageSize) : 21,
    });
  };

  getMcpManifest = async (params: { identifier: string; locale?: string; version?: string }) => {
    const locale = globalHelpers.getCurrentLanguage();
    return lambdaClient.market.getMcpManifest.query({
      ...params,
      locale,
    });
  };

  getMCPPluginManifest = async (
    identifier: string,
    options: { install?: boolean } = {},
  ): Promise<PluginManifest> => {
    const locale = globalHelpers.getCurrentLanguage();

    return lambdaClient.market.getMcpManifest.query({
      identifier,
      install: options.install,
      locale,
    });
  };

  registerClient = () => {
    return lambdaClient.market.registerClientInMarketplace.mutate({});
  };

  /**
   * Report MCP plugin installation result
   */
  reportMcpInstallResult = async ({
    success,
    manifest,
    errorMessage,
    errorCode,
    ...params
  }: InstallReportRequest) => {
    // if user don't allow tracing, just not report installation
    const allow = userGeneralSettingsSelectors.telemetry(useUserStore.getState());

    if (!allow) return;
    await this.injectMPToken();

    const reportData = {
      errorCode: success ? undefined : errorCode,
      errorMessage: success ? undefined : errorMessage,
      manifest: success ? manifest : undefined,
      success,
      ...params,
    };

    lambdaClient.market.reportMcpInstallResult
      .mutate(cleanObject(reportData))
      .catch((reportError) => {
        console.warn('Failed to report MCP installation result:', reportError);
      });
  };

  /**
   * Report plugin call result
   */
  reportPluginCall = async (reportData: CallReportRequest) => {
    // if user don't allow tracing , just not report calling
    const allow = userGeneralSettingsSelectors.telemetry(useUserStore.getState());

    if (!allow) return;

    await this.injectMPToken();

    lambdaClient.market.reportCall.mutate(cleanObject(reportData)).catch((reportError) => {
      console.warn('Failed to report call:', reportError);
    });
  };

  reportMcpEvent = async (eventData: PluginEventRequest) => {
    const allow = userGeneralSettingsSelectors.telemetry(useUserStore.getState());
    if (!allow) return;

    await this.injectMPToken();

    const payload = cleanObject({
      ...eventData,
      source: eventData.source ?? 'community/mcp',
    });

    lambdaClient.market.reportMcpEvent.mutate(payload).catch((error) => {
      console.warn('Failed to report MCP event:', error);
    });
  };

  /**
   * Report agent installation to increase install count
   */
  reportAgentInstall = async (identifier: string) => {
    // if user don't allow tracing, just not report installation
    const allow = userGeneralSettingsSelectors.telemetry(useUserStore.getState());

    if (!allow) return;

    await this.injectMPToken();

    lambdaClient.market.reportAgentInstall.mutate({ identifier }).catch((reportError) => {
      console.warn('Failed to report agent installation:', reportError);
    });
  };

  reportAgentEvent = async (eventData: AgentEventRequest) => {
    const allow = userGeneralSettingsSelectors.telemetry(useUserStore.getState());
    if (!allow) return;

    await this.injectMPToken();

    const payload = cleanObject({
      ...eventData,
      source: eventData.source ?? 'community/agent',
    });

    lambdaClient.market.reportAgentEvent.mutate(payload).catch((error) => {
      console.warn('Failed to report Agent event:', error);
    });
  };

  // ============================== Models ==============================

  getModelCategories = async (params: CategoryListQuery = {}): Promise<CategoryItem[]> => {
    return lambdaClient.market.getModelCategories.query(params);
  };

  getModelDetail = async (params: {
    identifier: string;
    locale?: string;
  }): Promise<DiscoverModelDetail | undefined> => {
    const locale = globalHelpers.getCurrentLanguage();
    return lambdaClient.market.getModelDetail.query({
      ...params,
      locale,
    });
  };

  getModelIdentifiers = async (): Promise<IdentifiersResponse> => {
    return lambdaClient.market.getModelIdentifiers.query();
  };

  getModelList = async (params: ModelQueryParams = {}): Promise<ModelListResponse> => {
    const locale = globalHelpers.getCurrentLanguage();
    return lambdaClient.market.getModelList.query({
      ...params,
      locale,
      page: params.page ? Number(params.page) : 1,
      pageSize: params.pageSize ? Number(params.pageSize) : 20,
    });
  };

  // ============================== Plugin Market ==============================

  getPluginCategories = async (params: CategoryListQuery = {}): Promise<CategoryItem[]> => {
    const locale = globalHelpers.getCurrentLanguage();
    return lambdaClient.market.getPluginCategories.query({
      ...params,
      locale,
    });
  };

  getPluginDetail = async (params: {
    identifier: string;
    locale?: string;
    withManifest?: boolean;
  }): Promise<DiscoverPluginDetail | undefined> => {
    const locale = globalHelpers.getCurrentLanguage();
    return lambdaClient.market.getPluginDetail.query({
      ...params,
      locale,
    });
  };

  getPluginIdentifiers = async (): Promise<IdentifiersResponse> => {
    return lambdaClient.market.getPluginIdentifiers.query();
  };

  getPluginList = async (params: PluginQueryParams = {}): Promise<PluginListResponse> => {
    const locale = globalHelpers.getCurrentLanguage();
    return lambdaClient.market.getPluginList.query({
      ...params,
      locale,
      page: params.page ? Number(params.page) : 1,
      pageSize: params.pageSize ? Number(params.pageSize) : 20,
    });
  };

  // ============================== Providers ==============================

  getProviderDetail = async (params: {
    identifier: string;
    locale?: string;
    withReadme?: boolean;
  }): Promise<DiscoverProviderDetail | undefined> => {
    const locale = globalHelpers.getCurrentLanguage();
    return lambdaClient.market.getProviderDetail.query({
      ...params,
      locale,
    });
  };

  getProviderIdentifiers = async (): Promise<IdentifiersResponse> => {
    return lambdaClient.market.getProviderIdentifiers.query();
  };

  getProviderList = async (params: ProviderQueryParams = {}): Promise<ProviderListResponse> => {
    const locale = globalHelpers.getCurrentLanguage();
    return lambdaClient.market.getProviderList.query({
      ...params,
      locale,
      page: params.page ? Number(params.page) : 1,
      pageSize: params.pageSize ? Number(params.pageSize) : 20,
    });
  };

  // ============================== User Profile ==============================

  getUserInfo = async (params: {
    locale?: string;
    username: string;
  }): Promise<DiscoverUserProfile | undefined> => {
    const locale = globalHelpers.getCurrentLanguage();
    return lambdaClient.market.getUserInfo.query({
      locale,
      username: params.username,
    });
  };

  // ============================== Helpers ==============================

  async injectMPToken() {
    if (typeof localStorage === 'undefined') return;

    // Check server-set status flag cookie
    const tokenStatus = this.getTokenStatusFromCookie();
    if (tokenStatus === 'active') return;

    let clientId: string;
    let clientSecret: string;

    // 1. Get client information from localStorage
    const item = localStorage.getItem('_mpc');
    if (!item) {
      // 2. If not exists, register client
      const clientInfo = await this.registerClient();
      clientId = clientInfo.clientId;
      clientSecret = clientInfo.clientSecret;

      // 3. Base64 encode and save to localStorage
      const clientData = JSON.stringify({ clientId, clientSecret });
      const encodedData = btoa(clientData);
      localStorage.setItem('_mpc', encodedData);
    } else {
      // 4. If exists, decode to get client information
      try {
        const decodedData = atob(item);
        const clientData = JSON.parse(decodedData);
        clientId = clientData.clientId;
        clientSecret = clientData.clientSecret;
      } catch (error) {
        console.error('Failed to decode client data:', error);
        // If decoding fails, re-register
        const clientInfo = await this.registerClient();
        clientId = clientInfo.clientId;
        clientSecret = clientInfo.clientSecret;

        const clientData = JSON.stringify({ clientId, clientSecret });
        const encodedData = btoa(clientData);
        localStorage.setItem('_mpc', encodedData);
      }
    }

    // 5. Get access token (server will automatically set HTTP-Only cookie)
    try {
      const result = await lambdaClient.market.registerM2MToken.query({
        clientId,
        clientSecret,
      });

      // Check server response result
      if (!result.success) {
        console.warn(
          'Token registration failed, client credentials may be invalid. Clearing and retrying...',
        );

        // Clear related local storage data
        localStorage.removeItem('_mpc');

        // Re-execute the complete registration process (but only retry once)
        if (!this._isRetrying) {
          this._isRetrying = true;
          try {
            await this.injectMPToken();
          } finally {
            this._isRetrying = false;
          }
        } else {
          console.error('Failed to re-register after credential invalidation');
        }

        return;
      }
    } catch (error) {
      console.error('Failed to register M2M token:', error);
      return null;
    }
  }

  private getTokenStatusFromCookie(): string | null {
    if (typeof document === 'undefined') return null;

    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'mp_token_status') {
        return value;
      }
    }
    return null;
  }

  // ============================== Group Agent Market ==============================

  getGroupAgentCategories = async (params: CategoryListQuery = {}): Promise<CategoryItem[]> => {
    const locale = globalHelpers.getCurrentLanguage();
    return lambdaClient.market.getGroupAgentCategories.query({
      ...params,
      locale,
    });
  };

  getGroupAgentDetail = async (params: {
    identifier: string;
    locale?: string;
    version?: string;
  }): Promise<any> => {
    const locale = globalHelpers.getCurrentLanguage();
    return lambdaClient.market.getGroupAgentDetail.query({
      identifier: params.identifier,
      locale,
      version: params.version,
    });
  };

  getGroupAgentIdentifiers = async (): Promise<IdentifiersResponse> => {
    return lambdaClient.market.getGroupAgentIdentifiers.query();
  };

  getGroupAgentList = async (params: GroupAgentQueryParams = {}): Promise<any> => {
    const locale = globalHelpers.getCurrentLanguage();
    return lambdaClient.market.agentGroup.getAgentGroupList.query(
      {
        ...params,
        locale,
        page: params.page ? Number(params.page) : 1,
        pageSize: params.pageSize ? Number(params.pageSize) : 20,
      },
      { context: { showNotification: false } },
    );
  };

  reportGroupAgentEvent = async (params: {
    event: 'add' | 'chat' | 'click';
    identifier: string;
    source?: string;
  }): Promise<void> => {
    await lambdaClient.market.reportGroupAgentEvent.mutate(params);
  };

  reportGroupAgentInstall = async (identifier: string): Promise<void> => {
    await lambdaClient.market.reportGroupAgentInstall.mutate({ identifier });
  };
}

export const discoverService = new DiscoverService();
