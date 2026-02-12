import { CURRENT_VERSION, isDesktop } from '@lobechat/const';
import { type LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';
import { type PluginItem, type PluginListResponse } from '@lobehub/market-sdk';
import { type TRPCClientError } from '@trpc/client';
import debug from 'debug';
import { uniqBy } from 'es-toolkit/compat';
import { produce } from 'immer';
import { gt, valid } from 'semver';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { type MCPErrorData } from '@/libs/mcp/types';
import { parseStdioErrorMessage } from '@/libs/mcp/types';
import { discoverService } from '@/services/discover';
import { mcpService } from '@/services/mcp';
import { pluginService } from '@/services/plugin';
import { globalHelpers } from '@/store/global/helpers';
import { mcpStoreSelectors } from '@/store/tool/selectors';
import { type StoreSetter } from '@/store/types';
import { McpConnectionType } from '@/types/discover';
import {
  type CheckMcpInstallResult,
  type McpConnectionParams,
  type MCPErrorInfo,
  type MCPInstallProgress,
  type MCPPluginListParams,
} from '@/types/plugins';
import { MCPInstallStep } from '@/types/plugins';
import { sleep } from '@/utils/sleep';
import { setNamespace } from '@/utils/storeDebug';

import { type ToolStore } from '../../store';
import { type MCPStoreState } from './initialState';

const log = debug('lobe-mcp:store:action');

const n = setNamespace('mcpStore');

const doesConfigSchemaRequireInput = (configSchema?: any) => {
  if (!configSchema) return false;

  const hasRequiredArray =
    Array.isArray(configSchema.required) && configSchema.required.some(Boolean);

  const hasRequiredProperty =
    !!configSchema.properties &&
    Object.values(configSchema.properties).some(
      (property: any) => property && property.required === true,
    );

  return hasRequiredArray || hasRequiredProperty;
};

const toNonEmptyStringRecord = (input?: Record<string, any>) => {
  if (!input) return undefined;

  const entries = Object.entries(input).filter(
    ([, value]) => value !== undefined && value !== null,
  );

  if (entries.length === 0) return undefined;

  return entries.reduce<Record<string, string>>((acc, [key, value]) => {
    acc[key] = typeof value === 'string' ? value : String(value);

    return acc;
  }, {});
};

/**
 * Build manifest for cloud MCP connection from market data
 */
const buildCloudMcpManifest = (params: {
  data: any;
  plugin: { description?: string; icon?: string; identifier: string };
}): LobeChatPluginManifest => {
  const { data, plugin } = params;

  log('Using cloud connection, building manifest from market data');

  // Get tools (MCP format) or api (LobeChat format) from data
  const mcpTools = data.tools;
  const lobeChatApi = data.api;

  // If MCP format tools, need to convert to LobeChat api format
  // MCP: { name, description, inputSchema }
  // LobeChat: { name, description, parameters }
  let apiArray: any[] = [];

  if (lobeChatApi) {
    // Already in LobeChat format, use directly
    apiArray = lobeChatApi;
    log('[Cloud MCP] Using existing LobeChat API format');
  } else if (mcpTools && Array.isArray(mcpTools)) {
    // Convert MCP tools format to LobeChat api format
    apiArray = mcpTools.map((tool: any) => ({
      description: tool.description || '',
      name: tool.name,
      parameters: tool.inputSchema || {},
    }));
    log('[Cloud MCP] Converted %d MCP tools to LobeChat API format', apiArray.length);
  } else {
    console.warn('[Cloud MCP] No tools or api found in manifest data');
  }

  // Build complete manifest
  const manifest: LobeChatPluginManifest = {
    api: apiArray,
    author: data.author?.name || data.author || '',
    createAt: data.createdAt || new Date().toISOString(),
    homepage: data.homepage || '',
    identifier: plugin.identifier,
    manifest: data.manifestUrl || '',
    meta: {
      avatar: data.icon || plugin.icon,
      description: plugin.description || data.description,
      tags: data.tags || [],
      title: data.name || plugin.identifier,
    },
    name: data.name || plugin.identifier,
    type: 'mcp',
    version: data.version,
  } as unknown as LobeChatPluginManifest;

  log('[Cloud MCP] Final manifest built:', {
    apiCount: manifest.api?.length,
    identifier: manifest.identifier,
    version: manifest.version,
  });

  return manifest;
};

// Test connection result type
export interface TestMcpConnectionResult {
  error?: string;
  /** STDIO process output logs for debugging */
  errorLog?: string;
  manifest?: LobeChatPluginManifest;
  success: boolean;
}

type Setter = StoreSetter<ToolStore>;
export const createMCPPluginStoreSlice = (set: Setter, get: () => ToolStore, _api?: unknown) =>
  new PluginMCPStoreActionImpl(set, get, _api);

export class PluginMCPStoreActionImpl {
  readonly #get: () => ToolStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ToolStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  cancelInstallMCPPlugin = async (identifier: string): Promise<void> => {
    // Get and cancel AbortController
    const abortController = this.#get().mcpInstallAbortControllers[identifier];
    if (abortController) {
      abortController.abort();

      // Clean up AbortController storage
      this.#set(
        produce((draft: MCPStoreState) => {
          delete draft.mcpInstallAbortControllers[identifier];
        }),
        false,
        n('cancelInstallMCPPlugin/clearController'),
      );
    }

    // Clean up installation progress and loading state
    this.#get().updateMCPInstallProgress(identifier, undefined);
    this.#get().updateInstallLoadingState(identifier, undefined);
  };

  cancelMcpConnectionTest = (identifier: string): void => {
    const abortController = this.#get().mcpTestAbortControllers[identifier];
    if (abortController) {
      abortController.abort();

      // Clean up state
      this.#set(
        produce((draft: MCPStoreState) => {
          draft.mcpTestLoading[identifier] = false;
          delete draft.mcpTestAbortControllers[identifier];
          delete draft.mcpTestErrors[identifier];
        }),
        false,
        n('cancelMcpConnectionTest'),
      );
    }
  };

  installMCPPlugin = async (
    identifier: string,
    options: { config?: Record<string, any>; resume?: boolean; skipDepsCheck?: boolean } = {},
  ): Promise<boolean | undefined> => {
    const { resume = false, config, skipDepsCheck } = options;
    const normalizedConfig = toNonEmptyStringRecord(config);
    let plugin = mcpStoreSelectors.getPluginById(identifier)(this.#get());

    if (!plugin || !plugin.manifestUrl) {
      const data = await discoverService.getMcpDetail({ identifier });
      if (!data) return;

      plugin = data as unknown as PluginItem;
    }

    if (!plugin) return;

    // Extract haveCloudEndpoint after plugin is loaded
    // @ts-expect-error
    const { haveCloudEndpoint } = plugin || {};

    const { updateInstallLoadingState, refreshPlugins, updateMCPInstallProgress } = this.#get();

    // Create AbortController for canceling installation
    const abortController = new AbortController();

    // Store AbortController
    this.#set(
      produce((draft: MCPStoreState) => {
        draft.mcpInstallAbortControllers[identifier] = abortController;
      }),
      false,
      n('installMCPPlugin/setController'),
    );

    // Record installation start time
    const installStartTime = Date.now();

    let data: any;
    let result: CheckMcpInstallResult | undefined;
    let connection: any;
    const userAgent = `LobeHub Desktop/${CURRENT_VERSION}`;

    try {
      // Check if already cancelled
      if (abortController.signal.aborted) {
        return;
      }

      if (resume) {
        // Resume mode: get previous info from storage
        const configInfo = this.#get().mcpInstallProgress[identifier];
        if (!configInfo) {
          console.error('No config info found for resume');
          return;
        }

        data = configInfo.manifest;
        connection = configInfo.connection ? { ...configInfo.connection } : undefined;
        result = configInfo.checkResult;
      } else {
        // Normal mode: start installation from scratch

        // Step 1: Fetch plugin manifest
        updateMCPInstallProgress(identifier, {
          progress: 15,
          step: MCPInstallStep.FETCHING_MANIFEST,
        });

        updateInstallLoadingState(identifier, true);

        // Check if already cancelled
        if (abortController.signal.aborted) {
          return;
        }

        data = await discoverService.getMCPPluginManifest(plugin.identifier, {
          install: true,
        });

        const deploymentOptions: any[] = Array.isArray(data.deploymentOptions)
          ? data.deploymentOptions
          : [];

        const httpOption =
          deploymentOptions.find(
            (option) => option?.connection?.url && option?.connection?.type === 'http',
          ) ||
          deploymentOptions.find((option) => option?.connection?.url && !option?.connection?.type);

        // Find stdio type deployment option
        const stdioOption = deploymentOptions.find(
          (option) =>
            option?.connection?.type === 'stdio' ||
            (!option?.connection?.type && !option?.connection?.url),
        );

        // Check if cloudEndPoint is available: stdio type + haveCloudEndpoint exists
        // Both desktop and web should use cloud endpoint if available
        const hasCloudEndpoint = stdioOption && haveCloudEndpoint;

        // Prioritize endpoint (http/cloud) over stdio in all environments
        // Desktop: endpoint > stdio
        // Web: endpoint only (stdio not supported)
        const shouldUseHttpDeployment = !!httpOption;

        if (hasCloudEndpoint) {
          // Use cloudEndPoint, create cloud type connection
          log('Using cloudEndPoint for stdio plugin: %s', haveCloudEndpoint);

          connection = {
            auth: stdioOption?.connection?.auth || { type: 'none' },
            cloudEndPoint: haveCloudEndpoint,
            headers: stdioOption?.connection?.headers,
            type: 'cloud',
          } as any;

          log('Using cloud connection: %O', {
            cloudEndPoint: haveCloudEndpoint,
            type: connection.type,
          });

          const configSchema = stdioOption?.connection?.configSchema;
          const needsConfig = doesConfigSchemaRequireInput(configSchema);

          if (needsConfig && !normalizedConfig) {
            updateMCPInstallProgress(identifier, {
              configSchema,
              connection,
              manifest: data,
              needsConfig: true,
              progress: 50,
              step: MCPInstallStep.CONFIGURATION_REQUIRED,
            });

            updateInstallLoadingState(identifier, undefined);
            return false;
          }
        } else if (shouldUseHttpDeployment && httpOption) {
          // HTTP type: skip system dependency check, use URL directly
          log('HTTP MCP detected, skipping system dependency check');

          connection = {
            auth: httpOption.connection?.auth || { type: 'none' },
            headers: httpOption.connection?.headers,
            type: 'http',
            url: httpOption.connection?.url,
          };

          log('Using HTTP connection: %O', { type: connection.type, url: connection.url });

          const configSchema = httpOption.connection?.configSchema;
          const needsConfig = doesConfigSchemaRequireInput(configSchema);

          if (needsConfig && !normalizedConfig) {
            updateMCPInstallProgress(identifier, {
              configSchema,
              connection,
              manifest: data,
              needsConfig: true,
              progress: 50,
              step: MCPInstallStep.CONFIGURATION_REQUIRED,
            });

            updateInstallLoadingState(identifier, undefined);
            return false;
          }
        } else {
          // stdio type: requires complete system dependency check process

          // Step 2: Check installation environment
          updateMCPInstallProgress(identifier, {
            progress: 30,
            step: MCPInstallStep.CHECKING_INSTALLATION,
          });

          // Check if already cancelled
          if (abortController.signal.aborted) {
            return;
          }

          result = await mcpService.checkInstallation(data, abortController.signal);

          if (!result.success) {
            updateMCPInstallProgress(identifier, undefined);
            return;
          }

          // Step 3: Check if system dependencies are met
          if (!skipDepsCheck && !result.allDependenciesMet) {
            // Dependencies not met, pause installation and show dependency installation guide
            updateMCPInstallProgress(identifier, {
              connection: result.connection,
              manifest: data,
              progress: 40,
              step: MCPInstallStep.DEPENDENCIES_REQUIRED,
              systemDependencies: result.systemDependencies,
            });

            // Pause installation, wait for user to install dependencies
            updateInstallLoadingState(identifier, undefined);
            return false; // Return false to indicate dependencies need to be installed
          }

          // Step 4: Check if configuration is needed
          if (result.needsConfig) {
            // Configuration needed, pause installation
            updateMCPInstallProgress(identifier, {
              checkResult: result,
              configSchema: result.configSchema,
              connection: result.connection,
              manifest: data,
              needsConfig: true,
              progress: 50,
              step: MCPInstallStep.CONFIGURATION_REQUIRED,
            });

            // Pause installation, wait for user configuration
            updateInstallLoadingState(identifier, undefined);
            return false; // Return false to indicate configuration is needed
          }

          connection = result.connection;
        }
      }

      let mergedHttpHeaders: Record<string, string> | undefined;
      let mergedStdioEnv: Record<string, string> | undefined;
      let mergedCloudHeaders: Record<string, string> | undefined;

      if (connection?.type === 'http') {
        const baseHeaders = toNonEmptyStringRecord(connection.headers);

        if (baseHeaders || normalizedConfig) {
          mergedHttpHeaders = {
            ...baseHeaders,
            ...normalizedConfig,
          };
        }
      }

      if (connection?.type === 'stdio') {
        const baseEnv = toNonEmptyStringRecord(connection.env);

        if (baseEnv || normalizedConfig) {
          mergedStdioEnv = {
            ...baseEnv,
            ...normalizedConfig,
          };
        }
      }

      if (connection?.type === 'cloud') {
        const baseHeaders = toNonEmptyStringRecord(connection.headers);

        if (baseHeaders || normalizedConfig) {
          mergedCloudHeaders = {
            ...baseHeaders,
            ...normalizedConfig,
          };
        }
      }

      // Get server manifest logic
      updateInstallLoadingState(identifier, true);

      // Step 5: Get server manifest
      updateMCPInstallProgress(identifier, {
        progress: 70,
        step: MCPInstallStep.GETTING_SERVER_MANIFEST,
      });

      // Check if already cancelled
      if (abortController.signal.aborted) {
        return;
      }

      let manifest: LobeChatPluginManifest | undefined;

      if (connection?.type === 'stdio') {
        manifest = await mcpService.getStdioMcpServerManifest(
          {
            args: connection.args,
            command: connection.command!,
            env: mergedStdioEnv,
            name: identifier, // Pass config as environment variables (in resume mode)
          },
          { avatar: plugin.icon, description: plugin.description, name: data.name },
          abortController.signal,
        );
      }
      if (connection?.type === 'http') {
        manifest = await mcpService.getStreamableMcpServerManifest(
          {
            auth: connection.auth,
            headers: mergedHttpHeaders,
            identifier,
            metadata: {
              avatar: plugin.icon,
              description: plugin.description,
            },
            url: connection.url!,
          },
          abortController.signal,
        );
      }
      if (connection?.type === 'cloud') {
        // Cloud type: build manifest directly from market data
        manifest = buildCloudMcpManifest({ data, plugin });
      }

      // set version
      if (manifest) {
        // set Version - use semver to compare versions and take the larger value
        const dataVersion = data?.version;
        const manifestVersion = manifest.version;

        if (dataVersion && manifestVersion) {
          // If both versions exist, compare and take the larger value
          if (valid(dataVersion) && valid(manifestVersion)) {
            manifest.version = gt(dataVersion, manifestVersion) ? dataVersion : manifestVersion;
          } else {
            // If version format is incorrect, prioritize dataVersion
            manifest.version = dataVersion;
          }
        } else {
          // If only one version exists, use the existing version
          manifest.version = dataVersion || manifestVersion;
        }
      }

      // Check if already cancelled
      if (abortController.signal.aborted) {
        return;
      }

      if (!manifest) {
        updateMCPInstallProgress(identifier, undefined);
        return;
      }

      // Step 6: Install plugin
      updateMCPInstallProgress(identifier, {
        progress: 90,
        step: MCPInstallStep.INSTALLING_PLUGIN,
      });

      // Check if already cancelled
      if (abortController.signal.aborted) {
        return;
      }

      // Update connection object, write merged configuration
      const finalConnection = { ...connection };
      if (finalConnection.type === 'http' && mergedHttpHeaders) {
        finalConnection.headers = mergedHttpHeaders;
      }
      if (finalConnection.type === 'stdio' && mergedStdioEnv) {
        finalConnection.env = mergedStdioEnv;
      }
      if (finalConnection.type === 'cloud' && mergedCloudHeaders) {
        finalConnection.headers = mergedCloudHeaders;
      }

      await pluginService.installPlugin({
        // For mcp, store connection info in customParams field first
        customParams: { mcp: finalConnection },
        identifier: plugin.identifier,
        manifest: manifest,
        settings: normalizedConfig,
        type: 'plugin',
      });

      // Check if already cancelled
      if (abortController.signal.aborted) {
        return;
      }

      await refreshPlugins();

      // Step 7: Complete installation
      updateMCPInstallProgress(identifier, {
        progress: 100,
        step: MCPInstallStep.COMPLETED,
      });

      // Calculate installation duration
      const installDurationMs = Date.now() - installStartTime;

      discoverService.reportMcpEvent({
        event: 'install',
        identifier: plugin.identifier,
        source: 'self',
      });

      discoverService.reportMcpInstallResult({
        identifier: plugin.identifier,
        installDurationMs,
        installParams: connection,
        manifest: {
          prompts: (manifest as any).prompts,
          resources: (manifest as any).resources,
          tools: (manifest as any).tools,
        },
        platform: result?.platform || process.platform,
        success: true,
        userAgent,
        version: manifest.version || data.version,
      });

      // Show completed status briefly then clear progress
      await sleep(1000);

      updateMCPInstallProgress(identifier, undefined);
      updateInstallLoadingState(identifier, undefined);

      // Clean up AbortController
      this.#set(
        produce((draft: MCPStoreState) => {
          delete draft.mcpInstallAbortControllers[identifier];
        }),
        false,
        n('installMCPPlugin/clearController'),
      );

      return true;
    } catch (e) {
      // Silently handle errors caused by cancellation
      if (abortController.signal.aborted) {
        console.log('MCP plugin installation cancelled for:', identifier);
        return;
      }

      const error = e as TRPCClientError<any>;

      console.error('MCP plugin installation failed:', error);

      // Calculate installation duration (failure case)
      const installDurationMs = Date.now() - installStartTime;

      // Handle structured error info
      let errorInfo: MCPErrorInfo;

      // If it's a structured MCPError
      if (!!error.data && 'errorData' in error.data) {
        const mcpError = error.data.errorData as MCPErrorData;

        errorInfo = {
          message: mcpError.message,
          metadata: mcpError.metadata,
          type: mcpError.type,
        };
      } else {
        // Fallback handling for normal errors
        const rawErrorMessage = error instanceof Error ? error.message : String(error);

        // Parse STDIO error message to extract process output logs
        const { originalMessage, errorLog } = parseStdioErrorMessage(rawErrorMessage);

        errorInfo = {
          message: originalMessage,
          metadata: {
            errorLog,
            params: connection
              ? {
                  args: connection.args,
                  command: connection.command,
                  type: connection.type,
                }
              : undefined,
            step: 'installation_error',
            timestamp: Date.now(),
          },
          type: 'UNKNOWN_ERROR',
        };
      }

      // Set error status, display structured error info
      updateMCPInstallProgress(identifier, {
        errorInfo,
        progress: 0,
        step: MCPInstallStep.ERROR,
      });

      // Report installation failure result
      discoverService.reportMcpInstallResult({
        errorCode: errorInfo.type,
        errorMessage: errorInfo.message,
        identifier: plugin.identifier,
        installDurationMs,
        installParams: connection,
        metadata: errorInfo.metadata,
        platform: result?.platform || process.platform,
        success: false,
        userAgent,
        version: data?.version,
      });

      updateInstallLoadingState(identifier, undefined);

      // Clean up AbortController
      this.#set(
        produce((draft: MCPStoreState) => {
          delete draft.mcpInstallAbortControllers[identifier];
        }),
        false,
        n('installMCPPlugin/clearController'),
      );
    }
  };

  loadMoreMCPPlugins = (): void => {
    const { mcpPluginItems, totalCount, currentPage } = this.#get();

    // Check if there's more data to load
    if (mcpPluginItems.length < (totalCount || 0)) {
      this.#set(
        produce((draft: MCPStoreState) => {
          draft.currentPage = currentPage + 1;
        }),
        false,
        n('loadMoreMCPPlugins'),
      );
    }
  };

  resetMCPPluginList = (keywords?: string): void => {
    this.#set(
      produce((draft: MCPStoreState) => {
        draft.mcpPluginItems = [];
        draft.currentPage = 1;
        draft.mcpSearchKeywords = keywords;
        draft.isMcpListInit = false;
      }),
      false,
      n('resetMCPPluginList'),
    );
  };

  testMcpConnection = async (params: McpConnectionParams): Promise<TestMcpConnectionResult> => {
    const { identifier, connection, metadata } = params;

    // Create AbortController for canceling test
    const abortController = new AbortController();

    // Store AbortController and set loading state
    this.#set(
      produce((draft: MCPStoreState) => {
        draft.mcpTestAbortControllers[identifier] = abortController;
        draft.mcpTestLoading[identifier] = true;
        draft.mcpTestErrors[identifier] = '';
      }),
      false,
      n('testMcpConnection/start'),
    );

    try {
      let manifest: LobeChatPluginManifest;

      if (connection.type === 'http') {
        if (!connection.url) {
          throw new Error('URL is required for HTTP connection');
        }

        manifest = await mcpService.getStreamableMcpServerManifest(
          {
            auth: connection.auth,
            headers: connection.headers,
            identifier,
            metadata,
            url: connection.url,
          },
          abortController.signal,
        );
      } else if (connection.type === 'stdio') {
        if (!connection.command) {
          throw new Error('Command is required for STDIO connection');
        }

        manifest = await mcpService.getStdioMcpServerManifest(
          {
            args: connection.args,
            command: connection.command,
            env: connection.env,
            name: identifier,
          },
          metadata,
          abortController.signal,
        );
      } else {
        throw new Error('Invalid MCP connection type');
      }

      // Check if already cancelled
      if (abortController.signal.aborted) {
        return { error: 'Test cancelled', success: false };
      }

      // Clean up state
      this.#set(
        produce((draft: MCPStoreState) => {
          draft.mcpTestLoading[identifier] = false;
          delete draft.mcpTestAbortControllers[identifier];
          delete draft.mcpTestErrors[identifier];
        }),
        false,
        n('testMcpConnection/success'),
      );

      discoverService.reportMcpEvent({
        event: 'activate',
        identifier: identifier,
        source: 'self',
      });

      return { manifest, success: true };
    } catch (error) {
      // Silently handle errors caused by cancellation
      if (abortController.signal.aborted) {
        return { error: 'Test cancelled', success: false };
      }

      const rawErrorMessage = error instanceof Error ? error.message : String(error);

      // Parse STDIO error message to extract process output logs
      const { originalMessage, errorLog } = parseStdioErrorMessage(rawErrorMessage);

      // Set error state
      this.#set(
        produce((draft: MCPStoreState) => {
          draft.mcpTestLoading[identifier] = false;
          draft.mcpTestErrors[identifier] = originalMessage;
          delete draft.mcpTestAbortControllers[identifier];
        }),
        false,
        n('testMcpConnection/error'),
      );

      return { error: originalMessage, errorLog, success: false };
    }
  };

  uninstallMCPPlugin = async (identifier: string): Promise<void> => {
    await pluginService.uninstallPlugin(identifier);
    await this.#get().refreshPlugins();

    discoverService.reportMcpEvent({
      event: 'uninstall',
      identifier: identifier,
      source: 'self',
    });
  };

  updateMCPInstallProgress = (
    identifier: string,
    progress: MCPInstallProgress | undefined,
  ): void => {
    this.#set(
      produce((draft: MCPStoreState) => {
        draft.mcpInstallProgress[identifier] = progress;
      }),
      false,
      n(`updateMCPInstallProgress/${progress?.step || 'clear'}`),
    );
  };

  useFetchMCPPluginList = (params: MCPPluginListParams): SWRResponse<PluginListResponse> => {
    const locale = globalHelpers.getCurrentLanguage();
    const requestParams = isDesktop
      ? params
      : { ...params, connectionType: McpConnectionType.http };
    const swrKeyParts = [
      'useFetchMCPPluginList',
      locale,
      requestParams.page,
      requestParams.pageSize,
      requestParams.q,
      requestParams.connectionType,
    ];
    const swrKey = swrKeyParts
      .filter((part) => part !== undefined && part !== null && part !== '')
      .join('-');
    const page = requestParams.page ?? 1;

    return useSWR<PluginListResponse>(
      swrKey,
      () => discoverService.getMCPPluginList(requestParams),
      {
        onSuccess: (data) => {
          this.#set(
            produce((draft: MCPStoreState) => {
              draft.searchLoading = false;

              // Set basic information
              if (!draft.isMcpListInit) {
                draft.activeMCPIdentifier = data.items?.[0]?.identifier;

                draft.isMcpListInit = true;
                draft.categories = data.categories;
                draft.totalCount = data.totalCount;
                draft.totalPages = data.totalPages;
              }

              // Accumulate data logic
              if (page === 1) {
                // First page, set directly
                draft.mcpPluginItems = uniqBy(data.items, 'identifier');
              } else {
                // Subsequent pages, accumulate data
                draft.mcpPluginItems = uniqBy(
                  [...draft.mcpPluginItems, ...data.items],
                  'identifier',
                );
              }
            }),
            false,
            n('useFetchMCPPluginList/onSuccess'),
          );
        },
        revalidateOnFocus: false,
      },
    );
  };
}

export type PluginMCPStoreAction = Pick<PluginMCPStoreActionImpl, keyof PluginMCPStoreActionImpl>;
