import { execFileSync, execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { type DeviceControlDeps, executeDeviceRpc as runDeviceRpc } from '@lobechat/device-control';
import type {
  AgentRunRequestMessage,
  GatewayMcpStdioParams,
} from '@lobechat/device-gateway-client';
import type {
  EditLocalFileParams,
  GatewayConnectionStatus,
  GetCommandOutputParams,
  GlobFilesParams,
  GrepContentParams,
  KillCommandParams,
  ListLocalFileParams,
  LocalReadFileParams,
  LocalReadFilesParams,
  LocalSearchFilesParams,
  MoveLocalFilesParams,
  RenameLocalFileParams,
  RunCommandParams,
  WriteLocalFileParams,
} from '@lobechat/electron-client-ipc';
import { type ILocalSystemService, LocalSystemExecutionRuntime } from '@lobechat/tool-runtime';

import GatewayConnectionService from '@/services/gatewayConnectionSrv';
import ImessageBridgeService from '@/services/imessageBridgeSrv';
import { createLogger } from '@/utils/logger';
import { setDesktopUserAgentHeader } from '@/utils/user-agent';

import HeterogeneousAgentCtr from './HeterogeneousAgentCtr';
import { ControllerModule, IpcMethod } from './index';
import LocalFileCtr from './LocalFileCtr';
import McpCtr from './McpCtr';
import RemoteServerConfigCtr from './RemoteServerConfigCtr';
import ShellCommandCtr from './ShellCommandCtr';

const logger = createLogger('controllers:GatewayConnectionCtr');

/**
 * Inject the lh-notify protocol into the first turn of a new hetero-agent session.
 * Tells the agent binary how to push results back to the LobeHub chat UI via `lh notify`.
 * Ported directly from apps/cli/src/tools/heteroTask.ts so desktop and CLI stay in sync.
 */
function buildNotifyProtocol(lhPath: string, topicId: string): string {
  return (
    `## Context: This task was dispatched by LobeHub\n\n` +
    `This conversation / task was sent to you by the **LobeHub platform** on behalf of a user. You are running as a background agent; the user is waiting for your response inside the LobeHub chat interface.\n\n` +
    `**When to call notify**: any time you have something meaningful to tell the user — a key finding, a decision you made, a result, a question, or your final answer.\n\n` +
    `**What to hide**: internal work details such as tool call sequences, file reads, intermediate command output, retries, or low-level reasoning steps.\n\n` +
    `## Sending messages back to the user\n\n` +
    `Use the \`${lhPath} notify\` command. All your updates appear as a **single message bubble** in the UI — create it once and update it in place.\n\n` +
    `**Step 1 — Open the bubble on your first meaningful update** (captures the messageId):\n` +
    `\`\`\`\n` +
    `MSG_ID=$(${lhPath} notify --topic ${topicId} --role assistant --content "Starting..." --json | grep -o '"messageId":"[^"]*"' | cut -d'"' -f4)\n` +
    `\`\`\`\n\n` +
    `**Step 2 — Update the same bubble as you make progress**:\n` +
    `\`\`\`\n` +
    `${lhPath} notify --topic ${topicId} --role assistant --message-id "$MSG_ID" --content "Still working..."\n` +
    `\`\`\`\n\n` +
    `**Step 3 — Replace with your complete, final response when done**:\n` +
    `\`\`\`\n` +
    `${lhPath} notify --topic ${topicId} --role assistant --message-id "$MSG_ID" --content "<your full response here>"\n` +
    `\`\`\`\n\n` +
    `Rules:\n` +
    `- Always use \`--json\` on the first call and capture \`messageId\` from the output.\n` +
    `- Always pass \`--message-id\` on every subsequent call so updates overwrite the same bubble.\n` +
    `- Call notify at least once when the task is done, even if there were no intermediate updates.`
  );
}

interface PlatformTaskEntry {
  agentId?: string;
  agentType: string;
  operationId: string;
  pid: number;
  topicId: string;
  /**
   * Workspace that owns the dispatched topic — used at exit time so the
   * cleanup notify still scopes to the workspace agentNotify resolves the
   * topic in (the server seeds this via the `runHeteroTask` args).
   */
  workspaceId?: string;
}

/**
 * Local mirror of `@lobechat/types`' `BuiltinServerRuntimeOutput`. Inlined
 * because the desktop tsconfig doesn't expose `@lobechat/types`, and the shape
 * is tiny + stable.
 */
interface BuiltinServerRuntimeOutput {
  content: string;
  error?: unknown;
  state?: unknown;
  success: boolean;
}

/**
 * Legacy API name aliases used by older gateway versions. Normalized to the
 * current `LocalSystemApiEnum` names before dispatch. `renameLocalFile` is
 * intentionally absent — it has no equivalent on the new surface and is
 * handled by a dedicated branch below.
 */
const LEGACY_API_ALIASES: Record<string, string> = {
  editLocalFile: 'editFile',
  globLocalFiles: 'globFiles',
  listLocalFiles: 'listFiles',
  moveLocalFiles: 'moveFiles',
  readLocalFile: 'readFile',
  searchLocalFiles: 'searchFiles',
  writeLocalFile: 'writeFile',
};

/**
 * Parse a JSON string, returning `undefined` on failure. Used to surface the
 * structured shape of platform-agent tool results (which return pre-stringified
 * JSON) as `state` for the renderer, without crashing on malformed input.
 */
const safeJsonParse = (input: string): unknown => {
  try {
    return JSON.parse(input);
  } catch {
    return undefined;
  }
};

/**
 * Resolve a relative path against a scope (CWD). Mirrors the renderer-side
 * `resolveArgsWithScope` helper in `@lobechat/builtin-tool-local-system` — kept
 * here as a small inline copy to avoid pulling the renderer-side `./client`
 * subpath (which transitively requires React + antd) into the main process.
 */
const resolveArgsWithScope = <T extends { scope?: string }>(args: T, pathField: string): T => {
  const scope = args.scope;
  const bag = args as Record<PropertyKey, unknown>;
  const currentPath = typeof bag[pathField] === 'string' ? (bag[pathField] as string) : undefined;
  if (!scope) return args;
  if (!currentPath) return { ...args, [pathField]: scope };
  if (path.isAbsolute(currentPath)) return args;
  return { ...args, [pathField]: path.join(scope, currentPath) };
};

/**
 * GatewayConnectionCtr
 *
 * Thin IPC layer that delegates to GatewayConnectionService.
 */
export default class GatewayConnectionCtr extends ControllerModule {
  static override readonly groupName = 'gatewayConnection';

  /** In-memory registry for running platform agent tasks (openclaw / hermes). */
  private readonly platformTasks = new Map<string, PlatformTaskEntry>();

  /** Maps topicId → hermes session_id for multi-turn conversation continuity. */
  private readonly hermesSessionMap = new Map<string, string>();

  private localSystemRuntime: LocalSystemExecutionRuntime | null = null;

  // ─── Service Accessor ───

  private get service() {
    return this.app.getService(GatewayConnectionService);
  }

  private get remoteServerConfigCtr() {
    return this.app.getController(RemoteServerConfigCtr);
  }

  private get localFileCtr() {
    return this.app.getController(LocalFileCtr);
  }

  private get shellCommandCtr() {
    return this.app.getController(ShellCommandCtr);
  }

  private get imessageBridgeSrv() {
    return this.app.getService(ImessageBridgeService);
  }

  private get heterogeneousAgentCtr() {
    return this.app.getController(HeterogeneousAgentCtr);
  }

  private get mcpCtr() {
    return this.app.getController(McpCtr);
  }

  // ─── Lifecycle ───

  afterAppReady() {
    const srv = this.service;

    srv.loadOrCreateDeviceId();

    // Wire up token provider and refresher
    srv.setTokenProvider(() => this.remoteServerConfigCtr.getAccessToken());
    srv.setTokenRefresher(() => this.remoteServerConfigCtr.refreshAccessToken());

    // Wire up tool call handler
    srv.setToolCallHandler((apiName, args) => this.executeToolCall(apiName, args));

    // Wire up MCP call handler (tunneled stdio MCP calls from the cloud server)
    srv.setMcpCallHandler((mcpCall) => this.executeMcpCall(mcpCall));

    // Wire up message API handler
    srv.setMessageApiHandler((platform, apiName, payload) =>
      this.executeMessageApi(platform, apiName, payload),
    );

    // Wire up agent run handler
    srv.setAgentRunHandler((request) => this.executeAgentRun(request));

    // Wire up generic device RPC handler (server-internal method forwarding,
    // e.g. workspace-init scans — never surfaced to the agent)
    srv.setRpcHandler((method, params) => this.executeDeviceRpc(method, params));

    // Wire up device registrar (persists this device to the server registry)
    srv.setDeviceRegistrar((info) => this.registerDevice(info));

    // Auto-connect if already logged in
    this.tryAutoConnect();
  }

  // ─── IPC Methods (Renderer → Main) ───

  @IpcMethod()
  async connect(): Promise<{ error?: string; success: boolean }> {
    this.app.storeManager.set('gatewayEnabled', true);
    return this.service.connect();
  }

  @IpcMethod()
  async disconnect(): Promise<{ success: boolean }> {
    this.app.storeManager.set('gatewayEnabled', false);
    return this.service.disconnect();
  }

  @IpcMethod()
  async getConnectionStatus(): Promise<{ status: GatewayConnectionStatus }> {
    return { status: this.service.getStatus() };
  }

  @IpcMethod()
  async getDeviceInfo(): Promise<{
    description: string;
    deviceId: string;
    hostname: string;
    name: string;
    platform: string;
  }> {
    return this.service.getDeviceInfo();
  }

  @IpcMethod()
  async setDeviceName(params: { name: string }): Promise<{ success: boolean }> {
    this.service.setDeviceName(params.name);
    return { success: true };
  }

  @IpcMethod()
  async setDeviceDescription(params: { description: string }): Promise<{ success: boolean }> {
    this.service.setDeviceDescription(params.description);
    return { success: true };
  }

  // ─── Auto Connect ───

  private async tryAutoConnect() {
    const gatewayEnabled = this.app.storeManager.get('gatewayEnabled');
    if (!gatewayEnabled) return;

    const isConfigured = await this.remoteServerConfigCtr.isRemoteServerConfigured();
    if (!isConfigured) return;

    const token = await this.remoteServerConfigCtr.getAccessToken();
    if (!token) return;

    await this.service.connect();
  }

  // ─── Agent Run Routing ───

  private async executeAgentRun(
    request: AgentRunRequestMessage,
  ): Promise<{ reason?: string; status: 'accepted' | 'rejected' }> {
    try {
      const serverUrl = await this.remoteServerConfigCtr.getRemoteServerUrl();
      if (!serverUrl) {
        return { reason: 'Remote server URL not configured', status: 'rejected' };
      }

      // Reuse this device's own logged-in session as the run identity. The
      // access token is a full user OIDC token (7-day TTL, longer than any run),
      // which heteroIngest/heteroFinish now accept (ownership-gated), AND which
      // gives the spawned Claude Code's nested `lh` calls a real login state —
      // unlike the narrow `hetero-operation` token, which only works for the
      // ingest endpoints. We deliberately do NOT pass the refresh token to the
      // CLI: the device stays the single refresher (refresh tokens rotate), and
      // the 7-day access token outlives the run so no mid-run refresh is needed.
      //
      // Fall back to the dispatched `request.jwt` when the device has no access
      // token (e.g. not logged in), preserving the prior behavior gracefully.
      const accessToken = await this.remoteServerConfigCtr.getAccessToken();
      const jwt = accessToken || request.jwt;

      // Fire-and-forget: lh hetero exec handles spawn -> adapt ->
      // BatchIngester -> heteroIngest/heteroFinish -> server -> Gateway -> clients.
      // Same command as spawnHeteroSandbox() on the server side.
      this.heterogeneousAgentCtr.spawnLhHeteroExec({
        agentType: request.agentType,
        args: request.args,
        cwd: request.cwd,
        imageList: request.imageList,
        jwt,
        operationId: request.operationId,
        prompt: request.prompt,
        resumeSessionId: request.resumeSessionId,
        serverUrl,
        systemContext: request.systemContext,
        topicId: request.topicId,
      });

      return { status: 'accepted' };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { reason, status: 'rejected' };
    }
  }

  // ─── Tool Call Routing ───

  /**
   * Lazy-construct the LocalSystemExecutionRuntime backed by a thin service
   * adapter over the existing controllers. The runtime is the same one the
   * renderer uses, so remote tool calls produce identical
   * `{ content, state, success }` envelopes — `content` is the LLM-facing
   * prompt text, `state` is the structured payload, both flow downstream
   * intact (the gateway / DeviceGateway / RuntimeExecutors paths preserve them
   * and write `state` to the tool message's `pluginState`).
   */
  private getLocalSystemRuntime(): LocalSystemExecutionRuntime {
    if (!this.localSystemRuntime) {
      const local = this.localFileCtr;
      const shell = this.shellCommandCtr;
      const service: ILocalSystemService = {
        editLocalFile: (p) => local.handleEditFile(p),
        getCommandOutput: (p) => shell.handleGetCommandOutput(p),
        globFiles: (p) => local.handleGlobFiles(p),
        grepContent: (p) => local.handleGrepContent(p),
        killCommand: (p) => shell.handleKillCommand(p),
        listLocalFiles: (p) => local.listLocalFiles(p),
        moveLocalFiles: (p) => local.handleMoveFiles(p),
        readLocalFile: (p) => local.readFile(p),
        readLocalFiles: (p) => local.readFiles(p),
        renameLocalFile: (p) => local.handleRenameFile(p),
        runCommand: (p) => shell.handleRunCommand(p),
        searchLocalFiles: (p) => local.handleLocalFilesSearch(p),
        writeFile: (p) => local.handleWriteFile(p),
      };
      this.localSystemRuntime = new LocalSystemExecutionRuntime(service);
    }
    return this.localSystemRuntime;
  }

  /**
   * Platform-specific handlers the shared `@lobechat/device-control` dispatcher
   * delegates to. Git + workspace-scan methods run inside device-control over
   * `@lobechat/local-file-shell`; only file preview / index (and preview
   * approval) are desktop-specific and routed back to the controllers here.
   */
  private get deviceControlDeps(): DeviceControlDeps {
    return {
      approveProjectRoot: async (root) => {
        try {
          await this.app.localFileProtocolManager.approveIndexedProjectRoot(root);
        } catch (error) {
          logger.error(`Failed to approve project preview root ${root}:`, error);
        }
      },
      getLocalFilePreview: (params) => this.localFileCtr.getLocalFilePreview(params),
      getProjectFileIndex: (params) => this.localFileCtr.getProjectFileIndex(params),
    };
  }

  /**
   * Dispatch a generic server-internal device RPC (not an agent tool call) by
   * method name. The dispatch logic lives in `@lobechat/device-control` so the
   * desktop main process and the CLI daemon share one device RPC surface.
   */
  private async executeDeviceRpc(method: string, params: unknown): Promise<unknown> {
    return runDeviceRpc(method, params, this.deviceControlDeps);
  }

  private async executeToolCall(
    apiName: string,
    args: unknown,
  ): Promise<BuiltinServerRuntimeOutput> {
    const runtime = this.getLocalSystemRuntime();
    const normalized = LEGACY_API_ALIASES[apiName] ?? apiName;

    // Each case narrows `args` to its IPC param type — the manifest guarantees
    // the gateway sends params matching the apiName. The `as never` casts on
    // runtime calls are legitimate widenings: the runtime's typed signatures
    // (e.g. `ListFilesParams`) are narrower than what the IPC layer accepts
    // (`limit`, `run_in_background`, etc.), and the same casts exist in the
    // renderer-side `LocalSystemExecutor`.
    switch (normalized) {
      case 'listFiles': {
        const p = args as ListLocalFileParams;
        return runtime.listFiles({
          directoryPath: p.path,
          limit: p.limit,
          sortBy: p.sortBy,
          sortOrder: p.sortOrder,
        } as never);
      }

      case 'readFile': {
        const p = args as LocalReadFileParams;
        return runtime.readFile({
          endLine: p.loc?.[1],
          path: p.path,
          startLine: p.loc?.[0],
        });
      }

      case 'readFiles': {
        return runtime.readFiles(args as LocalReadFilesParams);
      }

      case 'searchFiles': {
        const resolved = resolveArgsWithScope(args as LocalSearchFilesParams, 'directory');
        return runtime.searchFiles({
          ...resolved,
          directory: resolved.directory || '',
        });
      }

      case 'moveFiles': {
        const p = args as MoveLocalFilesParams;
        return runtime.moveFiles({
          operations: p.items?.map((item) => ({
            destination: item.newPath,
            source: item.oldPath,
          })),
        });
      }

      case 'writeFile': {
        return runtime.writeFile(args as WriteLocalFileParams);
      }

      case 'editFile': {
        const p = args as EditLocalFileParams;
        return runtime.editFile({
          all: p.replace_all,
          path: p.file_path,
          replace: p.new_string,
          search: p.old_string,
        });
      }

      case 'runCommand': {
        // ComputerRuntime's RunCommandState reads `args.background`; the manifest
        // exposes `run_in_background`. Without this normalize the state would
        // always show foreground even for background commands.
        const p = args as RunCommandParams;
        return runtime.runCommand({
          ...p,
          background: p.run_in_background,
        } as never);
      }

      case 'getCommandOutput': {
        const p = args as GetCommandOutputParams;
        return runtime.getCommandOutput({
          commandId: p.shell_id,
          filter: p.filter,
        } as never);
      }

      case 'killCommand': {
        const p = args as KillCommandParams;
        return runtime.killCommand({
          commandId: p.shell_id,
        });
      }

      case 'grepContent': {
        const resolved = resolveArgsWithScope(args as GrepContentParams, 'path');
        return runtime.grepContent(resolved as never);
      }

      case 'globFiles': {
        const p = args as GlobFilesParams;
        return runtime.globFiles({
          directory: p.scope,
          pattern: p.pattern,
        });
      }

      case 'renameLocalFile': {
        // ComputerRuntime has no public rename method — new surface uses
        // `moveFiles`. Legacy gateway versions may still emit this name, so we
        // call the IPC handler directly and wrap the raw result into the
        // BuiltinServerRuntimeOutput shape so `state` still flows downstream.
        const raw = await this.localFileCtr.handleRenameFile(args as RenameLocalFileParams);
        return {
          content: raw.success
            ? `Renamed to ${raw.newPath}`
            : `Rename failed: ${raw.error ?? 'unknown error'}`,
          state: raw,
          success: raw.success,
        };
      }

      // ─── Platform agent tools (openclaw / hermes) ───
      // These don't go through LocalSystemExecutionRuntime — they return raw
      // domain payloads that we envelope into BuiltinServerRuntimeOutput here.
      // `content` is the JSON-serialized payload (what the LLM reads); `state`
      // carries the parsed object so the renderer can render structured UI.

      case 'checkPlatformCapability': {
        const result = await this.checkPlatformCapability(args as { platform: string });
        return { content: JSON.stringify(result), state: result, success: true };
      }

      case 'getAgentProfile': {
        const result = await this.getAgentProfile(args as { agentId?: string; platform: string });
        return { content: JSON.stringify(result), state: result, success: true };
      }

      case 'runHeteroTask': {
        // runHeteroTask returns a pre-stringified JSON payload — pass it through
        // as `content` and surface the parsed shape as `state`.
        const json = await this.runHeteroTask(
          args as {
            agentId?: string;
            agentType: string;
            cwd?: string;
            operationId: string;
            prompt: string;
            taskId: string;
            topicId: string;
            workspaceId?: string;
          },
        );
        return { content: json, state: safeJsonParse(json), success: true };
      }

      case 'cancelHeteroTask': {
        const json = await this.cancelHeteroTask(args as { signal?: string; taskId: string });
        return { content: json, state: safeJsonParse(json), success: true };
      }

      default: {
        throw new Error(
          `Tool "${apiName}" is not available on this device. It may not be supported in the current desktop version. Please skip this tool and try alternative approaches.`,
        );
      }
    }
  }

  /**
   * Execute a stdio MCP tool call tunneled from the cloud server. The server
   * can't spawn the user's local MCP binary, so it forwards the connection
   * params (command/args/env); we run the call through the local MCP client,
   * which spawns the stdio server on this machine.
   */
  private async executeMcpCall(mcpCall: {
    apiName: string;
    arguments: string;
    identifier: string;
    params: GatewayMcpStdioParams;
  }): Promise<BuiltinServerRuntimeOutput> {
    const { apiName, arguments: args, params: stdioParams } = mcpCall;

    return this.mcpCtr.runStdioMcpTool({
      args,
      env: stdioParams.env,
      params: {
        args: stdioParams.args,
        command: stdioParams.command,
        name: stdioParams.name,
      },
      toolName: apiName,
    });
  }

  private async executeMessageApi(
    platform: string,
    apiName: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    if (platform === 'imessage') {
      return this.imessageBridgeSrv.handleGatewayMessageApi(apiName, payload);
    }

    throw new Error(
      `Message API "${platform}/${apiName}" is not available on this device. It may not be supported in the current desktop version.`,
    );
  }

  // ─── Platform Capability Probing ───

  private async checkPlatformCapability(args: {
    platform: string;
  }): Promise<{ available: boolean; reason?: string; version?: string }> {
    const { platform } = args;

    const binaryMap: Record<string, string> = {
      hermes: 'hermes',
      openclaw: 'openclaw',
    };

    const binary = binaryMap[platform];
    if (!binary) {
      return { available: false, reason: `Unknown platform: ${platform}` };
    }

    const whichCmd = process.platform === 'win32' ? `where ${binary}` : `which ${binary}`;

    try {
      execSync(whichCmd, { stdio: 'pipe' });
    } catch {
      return { available: false, reason: `${platform} is not installed on this device` };
    }

    try {
      const raw = execSync(`${binary} --version`, {
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();
      return { available: true, version: raw };
    } catch {
      return { available: true };
    }
  }

  private async getAgentProfile(args: { agentId?: string; platform: string }): Promise<{
    avatar?: string;
    description?: string;
    title?: string;
  }> {
    const { platform, agentId } = args;

    if (platform === 'openclaw') {
      return this.getOpenClawProfile(agentId);
    }

    if (platform === 'hermes') {
      return this.getHermesProfile();
    }

    return {};
  }

  private getHermesProfile(): { avatar?: string; description?: string; title?: string } {
    // Find the active profile (marked with ◆ in `hermes profile list`).
    let profileName: string | undefined;
    try {
      const listOutput = execFileSync('hermes', ['profile', 'list'], {
        encoding: 'utf8',
        timeout: 5000,
      });
      profileName = listOutput.match(/◆(\S+)/)?.[1];
    } catch {
      return {};
    }
    if (!profileName) return {};

    // Get the profile's filesystem path.
    let profilePath: string | undefined;
    try {
      const showOutput = execFileSync('hermes', ['profile', 'show', profileName], {
        encoding: 'utf8',
        timeout: 5000,
      });
      const raw = showOutput.match(/^Path:\s+(.+)/m)?.[1]?.trim();
      profilePath = raw?.replace(/^~(?=\/|$)/, os.homedir());
    } catch {
      // Profile path unavailable — still return name + avatar.
    }

    const description = profilePath
      ? this.readHermesSoulDescription(path.join(profilePath, 'SOUL.md'))
      : undefined;

    return { avatar: '⚡', description, title: profileName };
  }

  private readHermesSoulDescription(soulPath: string): string | undefined {
    try {
      const content = fs.readFileSync(soulPath, 'utf8');
      // Loop until stable to handle any malformed/nested comment sequences.
      let stripped = content;
      let previous: string;
      do {
        previous = stripped;
        stripped = stripped
          .replaceAll(/<!--[\s\S]*?-->/g, '') // strip complete HTML comments
          .replaceAll(/[<>]/g, '') // strip any remaining HTML delimiter chars
          .replaceAll(/^#+\s.*$/gm, ''); // strip Markdown headings
      } while (stripped !== previous);
      return (
        stripped
          .split('\n')
          .map((l) => l.trim())
          .find((l) => l.length > 0) || undefined
      );
    } catch {
      return undefined;
    }
  }

  private getOpenClawProfile(agentId?: string): {
    avatar?: string;
    description?: string;
    title?: string;
  } {
    let output: string;
    try {
      output = execFileSync('openclaw', ['agents', 'list', '--json'], {
        encoding: 'utf8',
        timeout: 5000,
      });
    } catch {
      return {};
    }

    let agents: Array<{
      id: string;
      identityEmoji?: string;
      identityName?: string;
      isDefault?: boolean;
      workspace?: string;
    }>;
    try {
      agents = JSON.parse(output) as typeof agents;
    } catch {
      return {};
    }

    const agent = agentId
      ? agents.find((a) => a.id === agentId)
      : (agents.find((a) => a.isDefault) ?? agents[0]);

    if (!agent) return {};

    const title = agent.identityName || undefined;
    const avatar = agent.identityEmoji || '🦞';
    const description = agent.workspace
      ? this.readDescriptionFromWorkspace(agent.workspace)
      : undefined;

    return { avatar, description, title };
  }

  private readDescriptionFromWorkspace(workspacePath: string): string | undefined {
    for (const filename of ['IDENTITY.md', 'SOUL.md']) {
      const filePath = path.join(workspacePath, filename);
      if (!fs.existsSync(filePath)) continue;

      const content = fs.readFileSync(filePath, 'utf8');
      const match = content.match(/\*{0,2}(?:Creature|Vibe|Description):?\*{0,2}\s*(.+)/i);
      if (!match) continue;

      const value = match[1].trim();
      if (/^[_*(（].*[）)*_]$|^(?:tbd|todo|n\/?a|none|待定|未定)$/i.test(value)) continue;
      return value;
    }
  }

  // ─── Platform Agent Task Execution ───
  //
  // Ported from apps/cli/src/tools/heteroTask.ts so that devices connected via
  // the desktop gateway can execute openclaw/hermes tasks without requiring `lh connect`.

  private async runHeteroTask(args: {
    agentId?: string;
    agentType: string;
    cwd?: string;
    operationId: string;
    prompt: string;
    taskId: string;
    topicId: string;
    workspaceId?: string;
  }): Promise<string> {
    const { agentId, agentType, cwd, operationId, prompt, taskId, topicId, workspaceId } = args;
    const workDir = cwd || process.cwd();

    const [serverUrl, accessToken] = await Promise.all([
      this.remoteServerConfigCtr.getRemoteServerUrl(),
      this.remoteServerConfigCtr.getAccessToken(),
    ]);

    // Inject auth + workspace scope into child env so `lh notify` can
    // authenticate AND target the same workspace as the dispatched topic
    // (without LOBEHUB_WORKSPACE_ID, the CLI's notify falls back to personal
    // mode and the workspace topic 404s).
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...(accessToken && { LOBEHUB_JWT: accessToken }),
      ...(serverUrl && { LOBEHUB_SERVER: serverUrl }),
      ...(workspaceId && { LOBEHUB_WORKSPACE_ID: workspaceId }),
    };

    if (agentType === 'openclaw') {
      const lhPath = this.resolveLhPath();
      const openclawAgent = process.env['OPENCLAW_AGENT_ID'] ?? 'main';

      // Always inject the notify protocol so openclaw knows how to report results
      // back to the LobeHub UI — even if the previous turn failed and the session
      // history was not cleanly committed.
      const enrichedPrompt = `${prompt}\n\n${buildNotifyProtocol(lhPath, topicId)}`;

      // Kill any existing openclaw process for this topicId before spawning a new one.
      // openclaw serialises session writes; a concurrent process holding the session
      // lock will cause the new one to exit with code 1.
      for (const [existingTaskId, entry] of this.platformTasks) {
        if (entry.topicId === topicId && entry.agentType === 'openclaw') {
          try {
            process.kill(entry.pid, 'SIGTERM');
          } catch {
            // Already exited — nothing to do.
          }
          this.platformTasks.delete(existingTaskId);
        }
      }

      const child = spawn(
        'openclaw',
        [
          'agent',
          '--agent',
          openclawAgent,
          '--session-id',
          topicId,
          '--message',
          enrichedPrompt,
          '--local',
        ],
        { cwd: workDir, detached: true, env: childEnv, stdio: 'ignore' },
      );

      const pid = child.pid;
      if (pid === undefined) throw new Error('Failed to get PID for openclaw process');
      child.unref();

      this.platformTasks.set(taskId, {
        agentId,
        agentType,
        operationId,
        pid,
        topicId,
        workspaceId,
      });

      child.on('close', (code, signal) => {
        this.platformTasks.delete(taskId);
        if (code !== 0 || signal !== null) {
          const text = signal
            ? `Task cancelled (signal: ${signal})`
            : `Task failed (exit code: ${code})`;
          void this.sendNotify({
            agentId,
            content: text,
            role: 'assistant',
            topicId,
            workspaceId,
          }).finally(() =>
            this.sendNotify({
              agentId,
              content: '',
              done: true,
              role: 'assistant',
              topicId,
              workspaceId,
            }),
          );
        } else {
          void this.sendNotify({
            agentId,
            content: '',
            done: true,
            role: 'assistant',
            topicId,
            workspaceId,
          });
        }
      });

      return JSON.stringify({ pid, taskId });
    }

    if (agentType === 'hermes') {
      // Kill any existing hermes process for this topicId before spawning a new one.
      for (const [existingTaskId, entry] of this.platformTasks) {
        if (entry.topicId === topicId && entry.agentType === 'hermes') {
          try {
            process.kill(entry.pid, 'SIGTERM');
          } catch {
            // Already exited — nothing to do.
          }
          this.platformTasks.delete(existingTaskId);
        }
      }

      // Resume the previous session for this topic if one exists.
      const existingSessionId = this.hermesSessionMap.get(topicId);
      const hermesArgs: string[] = ['chat', '--query', prompt, '--quiet', '--accept-hooks'];
      if (existingSessionId) {
        hermesArgs.push('--resume', existingSessionId);
      }

      // Hermes prints "session_id: <id>\n<response>" to stdout in --quiet mode.
      const child = spawn('hermes', hermesArgs, {
        cwd: workDir,
        detached: true,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      const pid = child.pid;
      if (pid === undefined) throw new Error('Failed to get PID for hermes process');
      child.unref();

      this.platformTasks.set(taskId, {
        agentId,
        agentType,
        operationId,
        pid,
        topicId,
        workspaceId,
      });

      let stdout = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.on('close', (code, signal) => {
        this.platformTasks.delete(taskId);

        if (code !== 0 || signal !== null) {
          const text = signal
            ? `Task cancelled (signal: ${signal})`
            : `Task failed (exit code: ${code})`;
          void this.sendNotify({
            agentId,
            content: text,
            role: 'assistant',
            topicId,
            workspaceId,
          }).finally(() =>
            this.sendNotify({
              agentId,
              content: '',
              done: true,
              role: 'assistant',
              topicId,
              workspaceId,
            }),
          );
          return;
        }

        // Parse "session_id: <id>" from the first line, response from the rest.
        const sessionIdMatch = stdout.match(/^session_id:\s*(\S+)/m);
        const sessionId = sessionIdMatch?.[1];
        const response = stdout.replace(/^session_id:[^\n]*\n?/, '').trim();

        if (sessionId) this.hermesSessionMap.set(topicId, sessionId);

        if (response) {
          void this.sendNotify({
            agentId,
            content: response,
            role: 'assistant',
            topicId,
            workspaceId,
          }).finally(() =>
            this.sendNotify({
              agentId,
              content: '',
              done: true,
              role: 'assistant',
              topicId,
              workspaceId,
            }),
          );
        } else {
          void this.sendNotify({
            agentId,
            content: '',
            done: true,
            role: 'assistant',
            topicId,
            workspaceId,
          });
        }
      });

      return JSON.stringify({ pid, taskId });
    }

    throw new Error(`Unsupported agentType: ${agentType}`);
  }

  private async cancelHeteroTask(args: { signal?: string; taskId: string }): Promise<string> {
    const { signal = 'SIGINT', taskId } = args;
    const entry = this.platformTasks.get(taskId);

    if (!entry) {
      return JSON.stringify({ message: `No task found with taskId: ${taskId}`, success: false });
    }

    // Both openclaw and hermes: kill by PID; the close handler sends the done signal.
    try {
      process.kill(entry.pid, signal);
    } catch {
      this.platformTasks.delete(taskId);
      await this.sendNotify({
        agentId: entry.agentId,
        content: 'Task already completed or cancelled',
        role: 'assistant',
        topicId: entry.topicId,
        workspaceId: entry.workspaceId,
      });
    }

    return JSON.stringify({ pid: entry.pid, signal, taskId });
  }

  /**
   * Send a notify message to the server so the frontend receives agent output or
   * a completion signal. Uses the tRPC agentNotify.notify endpoint directly —
   * this is the desktop counterpart to `lh notify` used by the CLI path.
   */
  private async sendNotify(params: {
    agentId?: string;
    content: string;
    done?: boolean;
    role: string;
    topicId: string;
    /**
     * Workspace scope for the notify. When set, attaches `X-Workspace-Id` so
     * agentNotify resolves the workspace-owned topic instead of falling back
     * to personal mode (which would 404 the lookup).
     */
    workspaceId?: string;
  }): Promise<void> {
    try {
      const [serverUrl, token] = await Promise.all([
        this.remoteServerConfigCtr.getRemoteServerUrl(),
        this.remoteServerConfigCtr.getAccessToken(),
      ]);
      if (!serverUrl || !token) return;

      const { workspaceId, ...body } = params;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Oidc-Auth': token,
      };
      if (workspaceId) headers['X-Workspace-Id'] = workspaceId;
      setDesktopUserAgentHeader(headers);

      await fetch(`${serverUrl}/trpc/lambda/agentNotify.notify`, {
        body: JSON.stringify({ json: body }),
        headers,
        method: 'POST',
      });
    } catch {
      // Fire-and-forget: openclaw's own `lh notify` calls are the primary channel.
    }
  }

  /**
   * Persist this device to the server registry via `device.register`.
   * Fire-and-forget from the connect path: a failure must not block the WS
   * connection, the device just won't appear in the offline list until the
   * next successful connect.
   */
  private async registerDevice(info: {
    deviceId: string;
    hostname: string;
    identitySource: string;
    platform: string;
  }): Promise<void> {
    const [serverUrl, token] = await Promise.all([
      this.remoteServerConfigCtr.getRemoteServerUrl(),
      this.remoteServerConfigCtr.getAccessToken(),
    ]);
    if (!serverUrl || !token) return;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Oidc-Auth': token,
    };
    setDesktopUserAgentHeader(headers);

    await fetch(`${serverUrl}/trpc/lambda/device.register`, {
      body: JSON.stringify({ json: info }),
      headers,
      method: 'POST',
    });
  }

  // ─── Platform Agent Helpers ───

  private resolveLhPath(): string {
    try {
      return execFileSync('which', ['lh'], { encoding: 'utf8' }).trim();
    } catch {
      return 'lh';
    }
  }
}
