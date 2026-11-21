import type { ListedMcpServerTool, ListMcpToolsParams } from '@lobechat/device-control';
import type { GatewayMcpParams } from '@lobechat/device-gateway-client';
import type { DeviceMcpRuntime, MCPClientParams } from '@lobechat/device-mcp';
import { resolveUserSpawnPath } from '@lobechat/heterogeneous-agents/resolveCliCommand';

import { createLambdaClient } from '../api/client';
import { log } from '../utils/logger';
import { uploadFileBuffer } from '../utils/uploadLocalFile';

type ToolAuth = Parameters<typeof createLambdaClient>[0];

export interface DeviceMcpCall {
  apiName: string;
  arguments: string;
  params: GatewayMcpParams;
  timeout?: number;
}

export interface DeviceMcpCallResult {
  content: string;
  error?: string;
  state?: unknown;
  success: boolean;
}

let runtime: Promise<DeviceMcpRuntime> | undefined;
/** The resolved runtime, so a synchronous exit path can still tear it down. */
let runtimeInstance: DeviceMcpRuntime | undefined;
/** Read per upload: the device's credentials may be refreshed mid-session. */
let currentToolAuth: () => ToolAuth | undefined = () => undefined;

const getRuntime = () => {
  // Lazy: the MCP SDK and the runtime load only once a device runs an MCP call.
  runtime ??= import('@lobechat/device-mcp').then(({ DeviceMcpRuntime }) => {
    runtimeInstance = new DeviceMcpRuntime({
      clientName: 'lobehub-cli-mcp-client',
      // An uploaded block's key is already the file's URL.
      getMediaUrl: async (url) => url,
      logger: { error: (message) => log.debug(message), warn: (message) => log.debug(message) },
      uploadMedia: async ({ buffer, filename, mimeType }) => {
        const auth = currentToolAuth();
        // A managed device's token authenticates with the gateway only.
        if (!auth) return undefined;
        const file = await uploadFileBuffer(createLambdaClient(auth), {
          buffer,
          fileName: filename,
          fileType: mimeType,
        });
        return (file as { url?: string })?.url;
      },
    });
    return runtimeInstance;
  });
  return runtime;
};

/**
 * A service manager (launchd / systemd) starts the daemon with a minimal PATH,
 * where `npx` / `uvx` / nvm binaries are missing. Spawn stdio servers with the
 * user's login-shell PATH, as the desktop app does, unless the connector set
 * its own PATH.
 */
const toClientParams = async (params: GatewayMcpParams): Promise<MCPClientParams> => {
  if (params.type === 'http') {
    return {
      auth: params.auth,
      headers: params.headers,
      name: params.name,
      type: 'http',
      url: params.url,
    };
  }

  const env = params.env ?? {};
  const spawnPath = env.PATH === undefined ? await resolveUserSpawnPath() : undefined;
  return {
    args: params.args ?? [],
    command: params.command,
    env: spawnPath ? { ...env, PATH: spawnPath } : params.env,
    name: params.name,
    type: 'stdio',
  };
};

/**
 * Run a tunneled MCP call on this machine — a stdio server, or an HTTP
 * endpoint only this machine's network reaches. Sessions are pooled across
 * calls (stateful stdio servers keep their state) for the life of the
 * connect process; {@link disposeDeviceMcp} ends them.
 */
export async function executeDeviceMcpCall(
  call: DeviceMcpCall,
  getToolAuth: () => ToolAuth | undefined,
): Promise<DeviceMcpCallResult> {
  currentToolAuth = getToolAuth;
  try {
    const mcp = await getRuntime();
    const result = await mcp.runTool(
      await toClientParams(call.params),
      call.apiName,
      call.arguments,
      {
        timeoutMs: call.timeout,
      },
    );
    return {
      content: result.content,
      error: result.error?.message,
      state: result.state,
      success: result.success,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: message, error: message, state: undefined, success: false };
  }
}

/**
 * List an MCP server's tools on this machine (the `listMcpTools` device RPC),
 * for a server the cloud must not connect to itself: an install, a tool
 * refresh or a connection test. Listed on the runtime the tunneled calls run
 * on, so a stdio server is listed on the session its calls then reuse.
 */
export async function listDeviceMcpTools({
  mcpApps,
  params,
}: ListMcpToolsParams): Promise<ListedMcpServerTool[]> {
  const mcp = await getRuntime();
  return mcp.listTools(await toClientParams(params), { mcpApps });
}

/**
 * Disconnect every pooled MCP session so no stdio server outlives the process.
 * Every disconnect starts synchronously, so an exit path that cannot await
 * (connect's `cleanup()` right before `process.exit`) still closes each
 * server's stdin; awaiting the result waits for the teardowns to settle.
 */
export async function disposeDeviceMcp(): Promise<void> {
  const instance = runtimeInstance;
  runtime = undefined;
  runtimeInstance = undefined;
  // `dispose()` starts every disconnect before its first await, so this call
  // is already under way when an un-awaited caller moves on.
  await instance?.dispose();
}
