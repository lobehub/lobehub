import type { ChildProcess } from 'node:child_process';

import { resolveClaudeAccountSpawnEnv } from '@lobechat/device-control/claude-code-account-routing';
import type { AgentRunRequestMessage } from '@lobechat/device-gateway-client';

import type HeterogeneousAgentCtr from './HeterogeneousAgentCtr';

export interface PlatformTaskEntry {
  agentId?: string;
  agentType: string;
  operationId: string;
  parentOperationId?: string;
  pid: number;
  topicId: string;
  /**
   * Workspace owning the dispatched topic (seeded by `runHeteroTask`), so the
   * exit-time cleanup notify scopes to the workspace agentNotify resolves it in.
   */
  workspaceId?: string;
}

export interface GatewayAgentRunDeps {
  getAccessToken: () => Promise<string | null | undefined>;
  getServerUrl: () => Promise<string | undefined>;
  heterogeneousAgentCtr: Pick<
    HeterogeneousAgentCtr,
    | 'getClaudeCodeInheritedRoutingEnv'
    | 'listClaudeCodeAccounts'
    | 'resolveClaudeCodeAccount'
    | 'spawnLhHeteroExec'
  >;
  /** Gateway-run processes by operationId, so `cancelHeteroTask` can kill them. */
  platformTasks: Map<string, PlatformTaskEntry>;
}

export interface GatewayAgentRunAck {
  reason?: string;
  status: 'accepted' | 'rejected';
}

/**
 * The Claude Code account the agent is routed to, as spawn env: its login on
 * this desktop (default, or a profile signed in from Manage accounts).
 */
const resolveClaudeAccountEnv = async (
  ctr: GatewayAgentRunDeps['heterogeneousAgentCtr'],
  request: AgentRunRequestMessage,
) =>
  resolveClaudeAccountSpawnEnv(request.claudeAccountRouting, {
    inheritedEnv: request.claudeAccountRouting
      ? await ctr.getClaudeCodeInheritedRoutingEnv().catch(() => ({}))
      : {},
    listLogins: () => ctr.listClaudeCodeAccounts(),
    prepareLogin: (externalAccountId) => ctr.resolveClaudeCodeAccount({ externalAccountId }),
  });

/**
 * Run a gateway-dispatched agent on this desktop by spawning the embedded
 * `lh hetero exec`, and acknowledge with the spawn outcome.
 */
export const executeGatewayAgentRun = async (
  request: AgentRunRequestMessage,
  deps: GatewayAgentRunDeps,
): Promise<GatewayAgentRunAck> => {
  const { heterogeneousAgentCtr, platformTasks } = deps;
  try {
    const serverUrl = await deps.getServerUrl();
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
    const accessToken = await deps.getAccessToken();
    const jwt = accessToken || request.jwt;

    const account = await resolveClaudeAccountEnv(heterogeneousAgentCtr, request);
    if (account.kind === 'reject') return { reason: account.reason, status: 'rejected' };

    // The embedded CLI handles spawn -> adapt -> BatchIngester ->
    // heteroIngest/heteroFinish -> server -> Gateway -> clients. Wait until
    // the process has actually spawned (or emitted an early error) before
    // acknowledging the server request.
    return await heterogeneousAgentCtr.spawnLhHeteroExec({
      accountEnv: account.env,
      agentId: request.agentId,
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
      // Register the spawned CLI process so `cancelHeteroTask` (sent by the
      // server's `interruptTask` when the user clicks Stop) can find and kill
      // it by operationId. The entry is cleaned up on child exit below.
      onChildSpawned: (child: ChildProcess) => {
        const pid = child.pid;
        if (pid === undefined) return;
        const taskId = request.operationId;
        platformTasks.set(taskId, {
          agentType: request.agentType,
          operationId: request.operationId,
          pid,
          topicId: request.topicId,
          workspaceId: request.ingestWorkspaceId ?? request.workspaceId,
        });
        child.once('exit', () => {
          // Only clear if this exit belongs to the current entry — a
          // superseding run for the same operationId may have already
          // replaced it.
          const current = platformTasks.get(taskId);
          if (current?.pid === pid) {
            platformTasks.delete(taskId);
          }
        });
      },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { reason, status: 'rejected' };
  }
};
