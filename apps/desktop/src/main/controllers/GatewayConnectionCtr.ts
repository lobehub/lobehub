import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { DeviceControlDeps } from '@lobechat/device-control';
import type { AgentRunRequestMessage, GatewayMcpParams } from '@lobechat/device-gateway-client';
import type { GatewayConnectionStatus } from '@lobechat/electron-client-ipc';
import { resolveRemotePlatformCommand } from '@lobechat/heterogeneous-agents/scanHost';
import { type ILocalSystemService, LocalSystemExecutionRuntime } from '@lobechat/tool-runtime';
import { execa } from 'execa';

import GatewayConnectionService from '@/services/gatewayConnectionSrv';
import ImessageBridgeService from '@/services/imessageBridgeSrv';
import { createLogger } from '@/utils/logger';
import { setDesktopUserAgentHeader } from '@/utils/user-agent';

import BrowserControlCtr from './BrowserControlCtr';
import HeterogeneousAgentCtr from './HeterogeneousAgentCtr';
import { ControllerModule, IpcMethod } from './index';
import LocalFileCtr from './LocalFileCtr';
import McpCtr from './McpCtr';
import RemoteServerConfigCtr from './RemoteServerConfigCtr';
import ShellCommandCtr from './ShellCommandCtr';

const logger = createLogger('controllers:GatewayConnectionCtr');

// Mirror of `BrowserManifest.identifier` from `@lobechat/builtin-tool-browser`.
// Hardcoded (not imported) so the desktop main process keeps zero builtin-tool
// package deps — importing one risks the @lobechat/types stub runtime leak.
const BrowserIdentifier = 'lobe-browser';

function parseHermesSessionId(stderr: string): string | undefined {
  for (const line of stderr.split(/\r?\n/).reverse()) {
    const match = line.match(/^session_id:\s*(\S+)\s*$/);
    if (match) return match[1];
  }

  return undefined;
}

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
  parentOperationId?: string;
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
 * GatewayConnectionCtr
 *
 * Thin IPC layer that delegates to GatewayConnectionService.
 */
export default class GatewayConnectionCtr extends ControllerModule {
  static override readonly groupName = 'gatewayConnection';

  /** In-memory registry for running platform agent tasks (openclaw / hermes). */
  private readonly platformTasks = new Map<string, PlatformTaskEntry>();
  private readonly platformTaskKillTimers = new Map<number, NodeJS.Timeout>();

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

  afterFirstFrame() {
    const srv = this.service;

    srv.loadOrCreateDeviceId();

    // Wire up token provider and refresher
    srv.setTokenProvider(() => this.remoteServerConfigCtr.getAccessToken());
    srv.setTokenRefresher(() => this.remoteServerConfigCtr.refreshAccessToken());

    // Wire up tool call handler
    srv.setToolCallHandler((identifier, apiName, args) =>
      this.executeToolCall(identifier, apiName, args),
    );

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

    // Wire up the workspace-share hooks: connect-token minting (startup restore
    // + token expiry) and the "row still registered?" probe that keeps a share
    // revoked while offline from resurrecting as a ghost device.
    srv.setWorkspaceTokenProvider((workspaceId) => this.mintWorkspaceConnectToken(workspaceId));
    srv.setWorkspaceDeviceChecker((workspaceId, deviceId) =>
      this.checkWorkspaceDeviceRegistered(workspaceId, deviceId),
    );

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
    deviceId: string;
    hostname: string;
    platform: string;
  }> {
    return this.service.getDeviceInfo();
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

      // The embedded CLI handles spawn -> adapt -> BatchIngester ->
      // heteroIngest/heteroFinish -> server -> Gateway -> clients. Wait until
      // the process has actually spawned (or emitted an early error) before
      // acknowledging the server request.
      return await this.heterogeneousAgentCtr.spawnLhHeteroExec({
        agentType: request.agentType,
        assistantMessageId: request.assistantMessageId,
        args: request.args,
        cwd: request.cwd,
        imageList: request.imageList,
        jwt,
        operationId: request.operationId,
        prompt: request.prompt,
        resumeFallbackSystemContext: request.resumeFallbackSystemContext,
        resumeSessionId: request.resumeSessionId,
        serverUrl,
        systemContext: request.systemContext,
        topicId: request.topicId,
        workspaceId: request.ingestWorkspaceId ?? request.workspaceId,
      });
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
      // Workspace share (server-driven enroll/unenroll RPCs): the service owns
      // the gateway connections, so both handlers route straight to it.
      enrollWorkspace: (params) => this.service.enrollWorkspace(params),
      getLocalFilePreview: (params) => this.localFileCtr.getLocalFilePreview(params),
      getProjectFileIndex: (params) => this.localFileCtr.getProjectFileIndex(params),
      listHeterogeneousAgentModels: (params) => this.heterogeneousAgentCtr.listModels(params),
      searchProjectFiles: (params) => this.localFileCtr.searchProjectFiles(params),
      unenrollWorkspace: (params) => this.service.unenrollWorkspace(params),
      // Skill-archive cache (`prepareSkillDirectory` RPC): reuse LocalFileCtr's
      // deps so gateway-prepared skills share one cache with the renderer-IPC path.
      ...this.localFileCtr.getSkillDirectoryDeps(),
    };
  }

  /**
   * Dispatch a generic server-internal device RPC (not an agent tool call) by
   * method name. The dispatch logic lives in `@lobechat/device-control` so the
   * desktop main process and the CLI daemon share one device RPC surface.
   */
  private async executeDeviceRpc(method: string, params: unknown): Promise<unknown> {
    const { executeDeviceRpc: runDeviceRpc } = await import('@lobechat/device-control');
    return runDeviceRpc(method, params, this.deviceControlDeps);
  }

  private async executeToolCall(
    identifier: string | undefined,
    apiName: string,
    args: unknown,
  ): Promise<BuiltinServerRuntimeOutput> {
    // Browser is a renderer-resident tool: forward to the client executor via
    // BrowserControlCtr instead of the local-system apiName switch below.
    if (identifier === BrowserIdentifier) {
      const result = await this.app
        .getController(BrowserControlCtr)
        .runGatewayToolCall(apiName, (args ?? {}) as Record<string, unknown>);
      return {
        content: result.content ?? '',
        error: result.error,
        state: result.state,
        success: result.success,
      };
    }

    // Local-system tools: one dispatch through the shared runtime entry, which
    // owns legacy alias normalization and IPC field mapping. The server runtime
    // already stripped any model-supplied `cwd` and injected the device-bound
    // `cwd`/`scope` into `args` (see its `WORKING_DIR_ARG` map), so the values
    // here are server-controlled — `trustArgsCwd` lets them ride through to the
    // IPC layer instead of being dropped like the previous per-tool switch did.
    const localSystemOutput = await this.getLocalSystemRuntime().executeToolCall(
      apiName,
      (args ?? {}) as Record<string, unknown>,
      { trustArgsCwd: true },
    );
    if (localSystemOutput) return localSystemOutput;

    switch (apiName) {
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

      case 'scanHeterogeneousAgents': {
        const { scanHeterogeneousAgentsOnHost } =
          await import('@lobechat/heterogeneous-agents/scanHost');
        const agents = await scanHeterogeneousAgentsOnHost();
        const result = { agents };
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
            parentOperationId?: string;
            platformAgentId?: string;
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
   * Execute an MCP tool call tunneled from the cloud server, for MCP servers
   * only this machine can reach: stdio (the server can't spawn the user's
   * local binary) and localhost / LAN HTTP endpoints (the server's fetch
   * can't reach them). The connection params ride along; we run the call
   * through the local MCP client.
   */
  private async executeMcpCall(mcpCall: {
    apiName: string;
    arguments: string;
    identifier: string;
    params: GatewayMcpParams;
  }): Promise<BuiltinServerRuntimeOutput> {
    const { apiName, arguments: args, params } = mcpCall;

    if (params.type === 'http') {
      return this.mcpCtr.runHttpMcpTool(
        { auth: params.auth, headers: params.headers, name: params.name, url: params.url },
        apiName,
        args,
      );
    }

    return this.mcpCtr.runStdioMcpTool({
      args,
      env: params.env,
      params: {
        args: params.args,
        command: params.command,
        name: params.name,
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

    const platformMap: Record<string, 'hermes' | 'openclaw'> = {
      hermes: 'hermes',
      openclaw: 'openclaw',
    };

    const platformType = platformMap[platform];
    if (!platformType) {
      return { available: false, reason: `Unknown platform: ${platform}` };
    }

    const status = await resolveRemotePlatformCommand(platformType);
    if (!status.available) {
      return { available: false, reason: `${platform} is not installed on this device` };
    }

    return status.version ? { available: true, version: status.version } : { available: true };
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
    parentOperationId?: string;
    platformAgentId?: string;
    prompt: string;
    taskId: string;
    topicId: string;
    workspaceId?: string;
  }): Promise<string> {
    const {
      agentId,
      agentType,
      cwd,
      operationId,
      parentOperationId,
      platformAgentId,
      prompt,
      taskId,
      topicId,
      workspaceId,
    } = args;
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
      LOBEHUB_OPERATION_ID: operationId,
      ...(serverUrl && { LOBEHUB_SERVER: serverUrl }),
      ...(workspaceId && { LOBEHUB_WORKSPACE_ID: workspaceId }),
    };
    const sessionKey = parentOperationId ? operationId : topicId;

    if (agentType === 'openclaw') {
      const commandStatus = await resolveRemotePlatformCommand('openclaw');
      if (!commandStatus.available || !commandStatus.path) {
        throw new Error('OpenClaw executable not found');
      }
      if (commandStatus.resolvedPathEnv) childEnv.PATH = commandStatus.resolvedPathEnv;
      const lhPath = this.resolveLhPath();
      const openclawAgent = platformAgentId?.trim() || process.env['OPENCLAW_AGENT_ID'] || 'main';

      // Always inject the notify protocol so openclaw knows how to report results
      // back to the LobeHub UI — even if the previous turn failed and the session
      // history was not cleanly committed.
      const enrichedPrompt = `${prompt}\n\n${buildNotifyProtocol(lhPath, topicId)}`;

      // Kill any existing openclaw process for this topicId before spawning a new one.
      // openclaw serialises session writes; a concurrent process holding the session
      // lock will cause the new one to exit with code 1.
      for (const [existingTaskId, entry] of this.platformTasks) {
        if (
          entry.agentType === 'openclaw' &&
          (existingTaskId === taskId ||
            (!parentOperationId && !entry.parentOperationId && entry.topicId === topicId))
        ) {
          this.killPlatformProcessTree(entry.pid, 'SIGTERM');
          this.platformTasks.delete(existingTaskId);
        }
      }

      const openclawArgs = [
        'agent',
        '--agent',
        openclawAgent,
        '--session-id',
        sessionKey,
        '--message',
        enrichedPrompt,
        '--local',
      ];
      const child =
        process.platform === 'win32'
          ? execa(commandStatus.path, openclawArgs, {
              cwd: workDir,
              detached: true,
              env: childEnv,
              reject: false,
              stdio: 'ignore',
            })
          : spawn(commandStatus.path, openclawArgs, {
              cwd: workDir,
              detached: true,
              env: childEnv,
              stdio: 'ignore',
            });

      const pid = child.pid;
      if (pid === undefined) throw new Error('Failed to get PID for openclaw process');
      child.unref();

      this.platformTasks.set(taskId, {
        agentId,
        agentType,
        operationId,
        parentOperationId,
        pid,
        topicId,
        workspaceId,
      });

      child.on('close', (code, signal) => {
        // Do not clear the process-group kill timer here: the group leader can
        // exit while detached tool children keep running. Escalation only stops
        // once the whole group is confirmed gone (see killPlatformProcessTree).
        if (this.platformTasks.get(taskId)?.pid !== pid) return;

        this.platformTasks.delete(taskId);
        if (code !== 0 || signal !== null) {
          const text = signal
            ? `Task cancelled (signal: ${signal})`
            : `Task failed (exit code: ${code})`;
          const terminalError = signal ? undefined : { message: text, type: 'HeteroProcessError' };
          void this.sendNotify({
            agentId,
            content: text,
            operationId,
            role: 'assistant',
            topicId,
            workspaceId,
          }).finally(() =>
            this.sendNotify({
              agentId,
              cancelled: !!signal,
              content: '',
              done: true,
              error: terminalError,
              operationId,
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
            operationId,
            role: 'assistant',
            topicId,
            workspaceId,
          });
        }
      });

      return JSON.stringify({ pid, taskId });
    }

    if (agentType === 'hermes') {
      const commandStatus = await resolveRemotePlatformCommand('hermes');
      if (!commandStatus.available || !commandStatus.path) {
        throw new Error('Hermes executable not found');
      }
      if (commandStatus.resolvedPathEnv) childEnv.PATH = commandStatus.resolvedPathEnv;
      // Kill any existing hermes process for this topicId before spawning a new one.
      for (const [existingTaskId, entry] of this.platformTasks) {
        if (
          entry.agentType === 'hermes' &&
          (existingTaskId === taskId ||
            (!parentOperationId && !entry.parentOperationId && entry.topicId === topicId))
        ) {
          this.killPlatformProcessTree(entry.pid, 'SIGTERM');
          this.platformTasks.delete(existingTaskId);
        }
      }

      // Resume the previous session for this topic if one exists.
      const existingSessionId = this.hermesSessionMap.get(sessionKey);
      const hermesArgs: string[] = ['chat', '--query', prompt, '--quiet', '--accept-hooks'];
      if (existingSessionId) {
        hermesArgs.push('--resume', existingSessionId);
      }

      // Hermes keeps stdout response-only in --quiet mode and prints the final
      // session_id to stderr so callers can resume the session on the next turn.
      const child =
        process.platform === 'win32'
          ? execa(commandStatus.path, hermesArgs, {
              cwd: workDir,
              detached: true,
              env: childEnv,
              reject: false,
              stderr: 'pipe',
              stdin: 'ignore',
              stdout: 'pipe',
            })
          : spawn(commandStatus.path, hermesArgs, {
              cwd: workDir,
              detached: true,
              env: childEnv,
              stdio: ['ignore', 'pipe', 'pipe'],
            });

      const pid = child.pid;
      if (pid === undefined) throw new Error('Failed to get PID for hermes process');
      child.unref();

      this.platformTasks.set(taskId, {
        agentId,
        agentType,
        operationId,
        parentOperationId,
        pid,
        topicId,
        workspaceId,
      });

      let stderr = '';
      let stdout = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('close', (code, signal) => {
        // Keep any pending process-group escalation; see openclaw close handler.
        if (this.platformTasks.get(taskId)?.pid !== pid) return;

        this.platformTasks.delete(taskId);

        if (code !== 0 || signal !== null) {
          const text = signal
            ? `Task cancelled (signal: ${signal})`
            : `Task failed (exit code: ${code})`;
          const terminalError = signal ? undefined : { message: text, type: 'HeteroProcessError' };
          void this.sendNotify({
            agentId,
            content: text,
            operationId,
            role: 'assistant',
            topicId,
            workspaceId,
          }).finally(() =>
            this.sendNotify({
              agentId,
              cancelled: !!signal,
              content: '',
              done: true,
              error: terminalError,
              operationId,
              role: 'assistant',
              topicId,
              workspaceId,
            }),
          );
          return;
        }

        // Diagnostics may precede the final ID, and context compaction can rotate
        // it, so persist the last complete session_id line emitted this turn.
        const sessionId = parseHermesSessionId(stderr);
        const response = stdout.trim();

        if (sessionId) this.hermesSessionMap.set(sessionKey, sessionId);

        if (response) {
          void this.sendNotify({
            agentId,
            content: response,
            operationId,
            role: 'assistant',
            topicId,
            workspaceId,
          }).finally(() =>
            this.sendNotify({
              agentId,
              content: '',
              done: true,
              operationId,
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
            operationId,
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

  /** Kill the complete detached platform-agent process tree. */
  private killPlatformProcessTree(pid: number, signal: NodeJS.Signals): void {
    if (process.platform === 'win32') {
      try {
        spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        // The wrapper already exited.
      }
      return;
    }

    let signalled = false;
    try {
      process.kill(-pid, signal);
      signalled = true;
    } catch {
      try {
        process.kill(pid, signal);
        signalled = true;
      } catch {
        // The process tree already exited.
      }
    }

    if (signalled && signal !== 'SIGKILL') {
      this.clearPlatformTaskKillTimer(pid);
      const timer = setTimeout(() => {
        this.platformTaskKillTimers.delete(pid);
        // The group leader's `close` can fire while detached tool children are
        // still alive; only stop escalating once the whole group is gone.
        if (!this.isPlatformProcessGroupAlive(pid)) return;
        logger.warn('Platform task did not exit after signal, escalating to SIGKILL:', pid);
        this.killPlatformProcessTree(pid, 'SIGKILL');
      }, 2000);
      timer.unref();
      this.platformTaskKillTimers.set(pid, timer);
    }
  }

  /** Whether the detached platform process group (or its leader) is still alive. */
  private isPlatformProcessGroupAlive(pid: number): boolean {
    try {
      process.kill(-pid, 0);
      return true;
    } catch {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    }
  }

  private clearPlatformTaskKillTimer(pid: number): void {
    const timer = this.platformTaskKillTimers.get(pid);
    if (!timer) return;

    clearTimeout(timer);
    this.platformTaskKillTimers.delete(pid);
  }

  private async cancelHeteroTask(args: { signal?: string; taskId: string }): Promise<string> {
    const { signal = 'SIGINT', taskId } = args;
    const entry = this.platformTasks.get(taskId);

    if (!entry) {
      return JSON.stringify({ message: `No task found with taskId: ${taskId}`, success: false });
    }

    // The close handler sends the terminal notify after the whole tree exits.
    this.killPlatformProcessTree(entry.pid, signal as NodeJS.Signals);

    return JSON.stringify({ pid: entry.pid, signal, taskId });
  }

  /**
   * Send a notify message to the server so the frontend receives agent output or
   * a completion signal. Uses the tRPC agentNotify.notify endpoint directly —
   * this is the desktop counterpart to `lh notify` used by the CLI path.
   */
  private async sendNotify(params: {
    agentId?: string;
    cancelled?: boolean;
    content: string;
    done?: boolean;
    error?: { message: string; type?: string };
    operationId?: string;
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

  /**
   * Build the auth headers for a workspace-scoped server call. The
   * `X-Workspace-Id` header is what routes the request through the workspace
   * (member+) procedures — same convention as `sendNotify` above.
   */
  private async buildWorkspaceHeaders(
    workspaceId: string,
  ): Promise<{ headers: Record<string, string>; serverUrl: string } | null> {
    const [serverUrl, token] = await Promise.all([
      this.remoteServerConfigCtr.getRemoteServerUrl(),
      this.remoteServerConfigCtr.getAccessToken(),
    ]);
    if (!serverUrl || !token) return null;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Oidc-Auth': token,
      'X-Workspace-Id': workspaceId,
    };
    setDesktopUserAgentHeader(headers);
    return { headers, serverUrl };
  }

  /**
   * Mint a workspace-device connect token via `device.mintWorkspaceConnectToken`.
   * Used by the gateway service when restoring persisted share connections and
   * when a workspace connection's token expires. Returns null when the desktop
   * has no usable auth (logged out) — the service treats that as "skip".
   */
  private async mintWorkspaceConnectToken(workspaceId: string): Promise<string | null> {
    const auth = await this.buildWorkspaceHeaders(workspaceId);
    if (!auth) return null;

    const res = await fetch(`${auth.serverUrl}/trpc/lambda/device.mintWorkspaceConnectToken`, {
      // The mutation takes no input; `{json: null}` is the superjson-encoded
      // empty payload the tRPC HTTP handler expects.
      body: JSON.stringify({ json: null }),
      headers: auth.headers,
      method: 'POST',
    });
    if (!res.ok) throw new Error(`mintWorkspaceConnectToken failed: HTTP ${res.status}`);

    const payload = (await res.json()) as { result?: { data?: { json?: { token?: unknown } } } };
    const minted = payload?.result?.data?.json?.token;
    return typeof minted === 'string' ? minted : null;
  }

  /**
   * Probe whether the workspace-scoped deviceId still has a registered row via
   * `device.listDevices`. Returns `false` only on a definitive "row gone"
   * answer; `undefined` on any failure — the service must not clear persisted
   * enrollments off an inconclusive check.
   */
  private async checkWorkspaceDeviceRegistered(
    workspaceId: string,
    deviceId: string,
  ): Promise<boolean | undefined> {
    try {
      const auth = await this.buildWorkspaceHeaders(workspaceId);
      if (!auth) return undefined;

      const res = await fetch(`${auth.serverUrl}/trpc/lambda/device.listDevices`, {
        headers: auth.headers,
      });
      if (!res.ok) return undefined;

      const payload = (await res.json()) as { result?: { data?: { json?: unknown } } };
      const devices = payload?.result?.data?.json;
      if (!Array.isArray(devices)) return undefined;

      return devices.some(
        (d: { deviceId?: unknown; registered?: unknown }) =>
          d?.deviceId === deviceId && d?.registered === true,
      );
    } catch {
      return undefined;
    }
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
