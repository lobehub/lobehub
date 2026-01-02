import { exec } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import superjson from 'superjson';

import FileService from '@/services/fileSrv';
import { createLogger } from '@/utils/logger';

import { MCPClient } from '../libs/mcp/client';
import type { MCPClientParams, ToolCallContent, ToolCallResult } from '../libs/mcp/types';
import { ControllerModule, IpcMethod } from './index';

const execPromise = promisify(exec);
const logger = createLogger('controllers:McpCtr');

/**
 * Desktop-only copy of `@lobechat/types`'s `CheckMcpInstallResult`.
 *
 * We intentionally keep it local to avoid pulling the web app's path-alias
 * expectations (e.g. `@/config/*`) into the desktop `tsgo` typecheck.
 */
interface CheckMcpInstallResult {
  allDependenciesMet?: boolean;
  allOptions?: Array<{
    allDependenciesMet?: boolean;
    connection?: {
      args?: string[];
      command?: string;
      installationMethod: string;
      packageName?: string;
      repositoryUrl?: string;
    };
    isRecommended?: boolean;
    packageInstalled?: boolean;
    systemDependencies?: Array<{
      error?: string;
      installed: boolean;
      meetRequirement: boolean;
      name: string;
      version?: string;
    }>;
  }>;
  configSchema?: any;
  connection?: {
    args?: string[];
    command?: string;
    type: 'stdio' | 'http';
    url?: string;
  };
  error?: string;
  isRecommended?: boolean;
  needsConfig?: boolean;
  packageInstalled?: boolean;
  platform: string;
  success: boolean;
  systemDependencies?: Array<{
    error?: string;
    installed: boolean;
    meetRequirement: boolean;
    name: string;
    version?: string;
  }>;
}

interface CustomPluginMetadata {
  avatar?: string;
  description?: string;
  name?: string;
}

interface GetStdioMcpServerManifestInput {
  args?: string[];
  command: string;
  env?: Record<string, string>;
  metadata?: CustomPluginMetadata;
  name: string;
  type?: 'stdio';
}

interface GetStreamableMcpServerManifestInput {
  auth?: {
    accessToken?: string;
    token?: string;
    type: 'none' | 'bearer' | 'oauth2';
  };
  headers?: Record<string, string>;
  identifier: string;
  metadata?: CustomPluginMetadata;
  url: string;
}

interface CallToolInput {
  args: any;
  env: any;
  params: GetStdioMcpServerManifestInput;
  toolName: string;
}

interface SuperJSONSerialized<T = unknown> {
  json: T;
  meta?: any;
}

const isSuperJSONSerialized = (value: unknown): value is SuperJSONSerialized => {
  if (!value || typeof value !== 'object') return false;
  return 'json' in value;
};

const deserializePayload = <T>(payload: unknown): T => {
  // Keep backward compatibility for older renderer builds that might not serialize yet
  if (isSuperJSONSerialized(payload)) return superjson.deserialize(payload as any) as T;
  return payload as T;
};

const serializePayload = <T>(payload: T): SuperJSONSerialized =>
  superjson.serialize(payload) as any;

const safeParseToRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value))
    return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        return parsed as Record<string, unknown>;
    } catch {
      // ignore
    }
  }
  return {};
};

const getFileExtensionFromMimeType = (mimeType: string, fallback: string) => {
  const [, ext] = mimeType.split('/');
  return ext || fallback;
};

const todayShard = () => new Date().toISOString().split('T')[0];

const toMarkdown = async (
  blocks: ToolCallContent[] | null | undefined,
  getHTTPURL: (key: string) => Promise<string>,
) => {
  if (!blocks) return '';

  const parts = await Promise.all(
    blocks.map(async (item) => {
      switch (item.type) {
        case 'text': {
          return item.text;
        }
        case 'image': {
          const url = await getHTTPURL(item.data);
          return `![](${url})`;
        }
        case 'audio': {
          const url = await getHTTPURL(item.data);
          return `<resource type="${item.type}" url="${url}" />`;
        }
        case 'resource': {
          return `<resource type="${item.type}">${JSON.stringify(item.resource)}</resource>}`;
        }
        default: {
          return '';
        }
      }
    }),
  );

  return parts.filter(Boolean).join('\n\n');
};

/**
 * MCP Controller (Desktop Main Process)
 * Implements the same routes as `src/server/routers/desktop/mcp.ts`, but via IPC.
 */
export default class McpCtr extends ControllerModule {
  static override readonly groupName = 'mcp';

  private get fileService() {
    return this.app.getService(FileService);
  }

  private async createClient(params: MCPClientParams) {
    const client = new MCPClient(params);
    await client.initialize();
    return client;
  }

  private async processContentBlocks(blocks: ToolCallContent[]): Promise<ToolCallContent[]> {
    return Promise.all(
      blocks.map(async (block) => {
        if (block.type !== 'image' && block.type !== 'audio') return block;

        const ext = getFileExtensionFromMimeType(
          block.mimeType,
          block.type === 'image' ? 'png' : 'mp3',
        );

        const base64 = block.data;
        const buffer = Buffer.from(base64, 'base64');
        const hash = createHash('sha256').update(buffer).digest('hex');
        const id = randomUUID();
        const filePath = path.posix.join('mcp', `${block.type}s`, todayShard(), `${id}.${ext}`);

        const { metadata } = await this.fileService.uploadFile({
          content: base64,
          filename: `${id}.${ext}`,
          hash,
          path: filePath,
          type: block.mimeType,
        });

        return { ...block, data: metadata.path };
      }),
    );
  }

  @IpcMethod()
  async getStdioMcpServerManifest(payload: SuperJSONSerialized<GetStdioMcpServerManifestInput>) {
    const input = deserializePayload<GetStdioMcpServerManifestInput>(payload);
    const params: MCPClientParams = {
      args: input.args || [],
      command: input.command,
      env: input.env,
      name: input.name,
      type: 'stdio',
    };

    const client = await this.createClient(params);
    try {
      const manifest = await client.listManifests();
      const identifier = input.name;

      const tools = manifest.tools || [];

      return serializePayload({
        api: tools.map((item) => ({
          description: item.description,
          name: item.name,
          parameters: item.inputSchema as any,
        })),
        identifier,
        meta: {
          avatar: input.metadata?.avatar || 'MCP_AVATAR',
          description:
            input.metadata?.description ||
            `${identifier} MCP server has ` +
              Object.entries(manifest)
                .filter(([key]) => ['tools', 'prompts', 'resources'].includes(key))
                .map(([key, item]) => `${(item as Array<any>)?.length} ${key}`)
                .join(','),
          title: input.metadata?.name || identifier,
        },
        ...manifest,
        mcpParams: params,
        type: 'mcp' as any,
      });
    } finally {
      await client.disconnect();
    }
  }

  @IpcMethod()
  async getStreamableMcpServerManifest(
    payload: SuperJSONSerialized<GetStreamableMcpServerManifestInput>,
  ) {
    const input = deserializePayload<GetStreamableMcpServerManifestInput>(payload);
    const params: MCPClientParams = {
      auth: input.auth,
      headers: input.headers,
      name: input.identifier,
      type: 'http',
      url: input.url,
    };

    const client = await this.createClient(params);
    try {
      const tools = await client.listTools();
      const identifier = input.identifier;

      return serializePayload({
        api: tools.map((item) => ({
          description: item.description,
          name: item.name,
          parameters: item.inputSchema as any,
        })),
        identifier,
        mcpParams: params,
        meta: {
          avatar: input.metadata?.avatar || 'MCP_AVATAR',
          description:
            input.metadata?.description ||
            `${identifier} MCP server has ${tools.length} tools, like "${tools[0]?.name}"`,
          title: identifier,
        },
        type: 'mcp' as any,
      });
    } finally {
      await client.disconnect();
    }
  }

  @IpcMethod()
  async callTool(payload: SuperJSONSerialized<CallToolInput>) {
    const input = deserializePayload<CallToolInput>(payload);
    const params: MCPClientParams = {
      args: input.params.args || [],
      command: input.params.command,
      env: input.env,
      name: input.params.name,
      type: 'stdio',
    };

    const client = await this.createClient(params);
    try {
      const args = safeParseToRecord(input.args);

      const raw = (await client.callTool(input.toolName, args)) as ToolCallResult;
      const processed = raw.isError ? raw.content : await this.processContentBlocks(raw.content);

      const content = await toMarkdown(processed, (key) => this.fileService.getFileHTTPURL(key));

      return serializePayload({
        content,
        state: { ...raw, content: processed },
        success: true,
      });
    } catch (error) {
      logger.error('callTool failed:', error);
      throw error;
    } finally {
      await client.disconnect();
    }
  }

  // ---------- MCP Install Check (local system) ----------

  private getInstallInstructions(installInstructions: any) {
    if (!installInstructions) return undefined;

    let current: string | undefined;

    switch (process.platform) {
      case 'darwin': {
        current = installInstructions.macos;
        break;
      }
      case 'linux': {
        current = installInstructions.linux_debian || installInstructions.linux;
        break;
      }
      case 'win32': {
        current = installInstructions.windows;
        break;
      }
    }

    return { current, manual: installInstructions.manual };
  }

  private async checkSystemDependency(dependency: any) {
    try {
      const checkCommand = dependency.checkCommand || `${dependency.name} --version`;
      const { stdout, stderr } = await execPromise(checkCommand);

      if (stderr && !stdout) {
        return {
          error: stderr,
          installInstructions: this.getInstallInstructions(dependency.installInstructions),
          installed: false,
          meetRequirement: false,
          name: dependency.name,
          requiredVersion: dependency.requiredVersion,
        };
      }

      const output = String(stdout || '').trim();
      let version = output;

      if (dependency.versionParsingRequired) {
        const versionMatch = output.match(/[Vv]?(\d+(\.\d+)*)/);
        if (versionMatch) version = versionMatch[0];
      }

      let meetRequirement = true;

      if (dependency.requiredVersion) {
        const currentVersion = String(version).replace(/^[Vv]/, '');
        const currentNum = Number.parseFloat(currentVersion);

        const requirementMatch = String(dependency.requiredVersion).match(/([<=>]+)?(\d+(\.\d+)*)/);
        if (requirementMatch) {
          const [, operator = '=', requiredVersion] = requirementMatch;
          const requiredNum = Number.parseFloat(requiredVersion);
          switch (operator) {
            case '>=': {
              meetRequirement = currentNum >= requiredNum;
              break;
            }
            case '>': {
              meetRequirement = currentNum > requiredNum;
              break;
            }
            case '<=': {
              meetRequirement = currentNum <= requiredNum;
              break;
            }
            case '<': {
              meetRequirement = currentNum < requiredNum;
              break;
            }
            default: {
              meetRequirement = currentNum === requiredNum;
              break;
            }
          }
        }
      }

      return {
        installInstructions: this.getInstallInstructions(dependency.installInstructions),
        installed: true,
        meetRequirement,
        name: dependency.name,
        requiredVersion: dependency.requiredVersion,
        version,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
        installInstructions: this.getInstallInstructions(dependency.installInstructions),
        installed: false,
        meetRequirement: false,
        name: dependency.name,
        requiredVersion: dependency.requiredVersion,
      };
    }
  }

  private async checkPackageInstalled(installationMethod: string, details: any) {
    if (installationMethod === 'npm') {
      const packageName = details?.packageName;
      if (!packageName) return { installed: false };

      try {
        const { stdout } = await execPromise(`npm list -g ${packageName} --depth=0`);
        if (!stdout.includes('(empty)') && stdout.includes(packageName)) return { installed: true };
      } catch {
        // ignore
      }

      try {
        await execPromise(`npx -y ${packageName} --version`);
        return { installed: true };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : 'Unknown error',
          installed: false,
        };
      }
    }

    if (installationMethod === 'python') {
      const packageName = details?.packageName;
      if (!packageName) return { installed: false };

      const pythonCommand = details?.pythonCommand || 'python';

      try {
        const command = `${pythonCommand} -m pip list | grep -i "${packageName}"`;
        const { stdout } = await execPromise(command);
        if (stdout.trim() && stdout.toLowerCase().includes(String(packageName).toLowerCase())) {
          return { installed: true };
        }
      } catch {
        // ignore
      }

      try {
        const importCommand = `${pythonCommand} -c "import ${String(packageName).replace('-', '_')}; print('Package installed')"`;
        const { stdout } = await execPromise(importCommand);
        if (stdout.includes('Package installed')) return { installed: true };
      } catch {
        // ignore
      }

      return { installed: false };
    }

    // manual or unknown
    return { installed: false };
  }

  private async checkDeployOption(option: any) {
    const systemDependenciesResults = [];

    if (Array.isArray(option.systemDependencies) && option.systemDependencies.length > 0) {
      for (const dep of option.systemDependencies) {
        systemDependenciesResults.push(await this.checkSystemDependency(dep));
      }
    }

    const packageResult = await this.checkPackageInstalled(
      option.installationMethod,
      option.installationDetails,
    );
    const packageInstalled = Boolean((packageResult as any).installed);

    const allDependenciesMet = systemDependenciesResults.every((dep: any) => dep.meetRequirement);

    const configSchema = option.connection?.configSchema;
    const needsConfig = Boolean(
      configSchema &&
      ((Array.isArray(configSchema.required) && configSchema.required.length > 0) ||
        (configSchema.properties &&
          Object.values(configSchema.properties).some((prop: any) => prop.required === true))),
    );

    const connection = option.connection?.url
      ? { ...option.connection, type: 'http' }
      : { ...option.connection, type: 'stdio' };

    return {
      allDependenciesMet,
      configSchema,
      connection,
      isRecommended: option.isRecommended,
      needsConfig,
      packageInstalled,
      systemDependencies: systemDependenciesResults,
    };
  }

  @IpcMethod()
  async validMcpServerInstallable(
    payload: SuperJSONSerialized<{
      deploymentOptions: any[];
    }>,
  ) {
    const input = deserializePayload<{ deploymentOptions: any[] }>(payload);
    try {
      const options = input.deploymentOptions || [];
      const results = [];

      for (const option of options) {
        results.push(await this.checkDeployOption(option));
      }

      const recommendedResult = results.find((r: any) => r.isRecommended && r.allDependenciesMet);
      const firstInstallableResult = results.find((r: any) => r.allDependenciesMet);
      const bestResult = recommendedResult || firstInstallableResult || results[0];

      const checkResult: CheckMcpInstallResult = {
        ...(bestResult || {}),
        allOptions: results as any,
        platform: process.platform,
        success: true,
      };

      if (bestResult?.needsConfig) {
        checkResult.needsConfig = true;
        checkResult.configSchema = bestResult.configSchema;
      }

      return serializePayload(checkResult);
    } catch (error) {
      return serializePayload({
        error:
          error instanceof Error
            ? error.message
            : 'Unknown error when checking MCP plugin installation status',
        platform: process.platform,
        success: false,
      });
    }
  }
}
