import { execFileSync, execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { AgentRunRequestMessage } from '@lobechat/device-gateway-client';
import type { GatewayConnectionStatus } from '@lobechat/electron-client-ipc';

import GatewayConnectionService from '@/services/gatewayConnectionSrv';
import ImessageBridgeService from '@/services/imessageBridgeSrv';

import HeterogeneousAgentCtr from './HeterogeneousAgentCtr';
import { ControllerModule, IpcMethod } from './index';
import LocalFileCtr from './LocalFileCtr';
import RemoteServerConfigCtr from './RemoteServerConfigCtr';
import ShellCommandCtr from './ShellCommandCtr';

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
}

type ToolCallHandler = () => Promise<unknown>;
type ToolCallHandlerMap = Record<string, ToolCallHandler>;

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

  // ─── Lifecycle ───

  afterAppReady() {
    const srv = this.service;

    srv.loadOrCreateDeviceId();

    // Wire up token provider and refresher
    srv.setTokenProvider(() => this.remoteServerConfigCtr.getAccessToken());
    srv.setTokenRefresher(() => this.remoteServerConfigCtr.refreshAccessToken());

    // Wire up tool call handler
    srv.setToolCallHandler((apiName, args) => this.executeToolCall(apiName, args));

    // Wire up message API handler
    srv.setMessageApiHandler((platform, apiName, payload) =>
      this.executeMessageApi(platform, apiName, payload),
    );

    // Wire up agent run handler
    srv.setAgentRunHandler((request) => this.executeAgentRun(request));

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

      // Fire-and-forget: lh hetero exec handles spawn -> adapt ->
      // BatchIngester -> heteroIngest/heteroFinish -> server -> Gateway -> clients.
      // Same command as spawnHeteroSandbox() on the server side.
      this.heterogeneousAgentCtr.spawnLhHeteroExec({
        agentType: request.agentType,
        cwd: request.cwd,
        jwt: request.jwt,
        operationId: request.operationId,
        prompt: request.prompt,
        resumeSessionId: request.resumeSessionId,
        serverUrl,
        topicId: request.topicId,
      });

      return { status: 'accepted' };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { reason, status: 'rejected' };
    }
  }

  // ─── Tool Call Routing ───

  private async executeToolCall(apiName: string, args: any): Promise<unknown> {
    const methodMap = {
      ...this.getLocalFileToolHandlers(args),
      ...this.getShellCommandToolHandlers(args),
      ...this.getPlatformAgentToolHandlers(args),
    } satisfies ToolCallHandlerMap;

    const handler = methodMap[apiName];
    if (!handler) {
      throw new Error(
        `Tool "${apiName}" is not available on this device. It may not be supported in the current desktop version. Please skip this tool and try alternative approaches.`,
      );
    }

    return handler();
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

  private getLocalFileToolHandlers(args: any): ToolCallHandlerMap {
    const editFile = () => this.localFileCtr.handleEditFile(args);
    const globFiles = () => this.localFileCtr.handleGlobFiles(args);
    const listFiles = () => this.localFileCtr.listLocalFiles(args);
    const moveFiles = () => this.localFileCtr.handleMoveFiles(args);
    const readFile = () => this.localFileCtr.readFile(args);
    const searchFiles = () => this.localFileCtr.handleLocalFilesSearch(args);
    const writeFile = () => this.localFileCtr.handleWriteFile(args);

    return {
      editFile,
      globFiles,
      grepContent: () => this.localFileCtr.handleGrepContent(args),
      listFiles,
      moveFiles,
      readFile,
      searchFiles,
      writeFile,

      // Legacy aliases — keep these so older Gateway versions sending the long
      // names continue to route correctly. `renameLocalFile` is also kept even
      // though the new surface drops rename (it's now handled by `moveFiles`).
      editLocalFile: editFile,
      globLocalFiles: globFiles,
      listLocalFiles: listFiles,
      moveLocalFiles: moveFiles,
      readLocalFile: readFile,
      renameLocalFile: () => this.localFileCtr.handleRenameFile(args),
      searchLocalFiles: searchFiles,
      writeLocalFile: writeFile,
    };
  }

  private getShellCommandToolHandlers(args: any): ToolCallHandlerMap {
    return {
      getCommandOutput: () => this.shellCommandCtr.handleGetCommandOutput(args),
      killCommand: () => this.shellCommandCtr.handleKillCommand(args),
      runCommand: () => this.shellCommandCtr.handleRunCommand(args),
    };
  }

  private getPlatformAgentToolHandlers(args: any): ToolCallHandlerMap {
    return {
      // Platform agent capability probing
      checkPlatformCapability: () => this.checkPlatformCapability(args),
      getAgentProfile: () => this.getAgentProfile(args),

      // Platform agent task execution (openclaw / hermes)
      cancelHeteroTask: () => this.cancelHeteroTask(args),
      runHeteroTask: () => this.runHeteroTask(args),
    };
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
  }): Promise<string> {
    const { agentId, agentType, cwd, operationId, prompt, taskId, topicId } = args;
    const workDir = cwd || process.cwd();

    const [serverUrl, accessToken] = await Promise.all([
      this.remoteServerConfigCtr.getRemoteServerUrl(),
      this.remoteServerConfigCtr.getAccessToken(),
    ]);

    // Inject auth into child env so `lh notify` can authenticate without CLI config.
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...(accessToken && { LOBEHUB_JWT: accessToken }),
      ...(serverUrl && { LOBEHUB_SERVER: serverUrl }),
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

      this.platformTasks.set(taskId, { agentId, agentType, operationId, pid, topicId });

      child.on('close', (code, signal) => {
        this.platformTasks.delete(taskId);
        if (code !== 0 || signal !== null) {
          const text = signal
            ? `Task cancelled (signal: ${signal})`
            : `Task failed (exit code: ${code})`;
          void this.sendNotify({ agentId, content: text, role: 'assistant', topicId }).finally(() =>
            this.sendNotify({ agentId, content: '', done: true, role: 'assistant', topicId }),
          );
        } else {
          void this.sendNotify({ agentId, content: '', done: true, role: 'assistant', topicId });
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

      this.platformTasks.set(taskId, { agentId, agentType, operationId, pid, topicId });

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
          void this.sendNotify({ agentId, content: text, role: 'assistant', topicId }).finally(() =>
            this.sendNotify({ agentId, content: '', done: true, role: 'assistant', topicId }),
          );
          return;
        }

        // Parse "session_id: <id>" from the first line, response from the rest.
        const sessionIdMatch = stdout.match(/^session_id:\s*(\S+)/m);
        const sessionId = sessionIdMatch?.[1];
        const response = stdout.replace(/^session_id:[^\n]*\n?/, '').trim();

        if (sessionId) this.hermesSessionMap.set(topicId, sessionId);

        if (response) {
          void this.sendNotify({ agentId, content: response, role: 'assistant', topicId }).finally(
            () => this.sendNotify({ agentId, content: '', done: true, role: 'assistant', topicId }),
          );
        } else {
          void this.sendNotify({ agentId, content: '', done: true, role: 'assistant', topicId });
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
  }): Promise<void> {
    try {
      const [serverUrl, token] = await Promise.all([
        this.remoteServerConfigCtr.getRemoteServerUrl(),
        this.remoteServerConfigCtr.getAccessToken(),
      ]);
      if (!serverUrl || !token) return;

      await fetch(`${serverUrl}/trpc/lambda/agentNotify.notify`, {
        body: JSON.stringify({ json: params }),
        headers: {
          'Content-Type': 'application/json',
          'Oidc-Auth': token,
        },
        method: 'POST',
      });
    } catch {
      // Fire-and-forget: openclaw's own `lh notify` calls are the primary channel.
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
