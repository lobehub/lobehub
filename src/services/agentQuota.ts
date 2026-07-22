import type {
  ClaudeCodeAccountIdentity,
  ClaudeCodeQuotaReading,
} from '@lobechat/electron-client-ipc';

import { lambdaClient } from '@/libs/trpc/client';

/**
 * Renderer-side service for the account-scoped quota data layer (persisted via
 * the lambda tRPC → server DB). Distinct from `heterogeneousAgentService`, which
 * fetches the *live* quota from the local CLI login over Electron IPC.
 */
class AgentQuotaService {
  /** Persist a live Claude snapshot (identity + readings) captured over IPC. */
  ingestClaudeSnapshot = async (params: {
    identity: ClaudeCodeAccountIdentity;
    readings: ClaudeCodeQuotaReading[];
  }) =>
    lambdaClient.agentQuota.ingestSnapshot.mutate({
      identity: params.identity,
      provider: 'claude-code',
      readings: params.readings.map((r) => ({ ...r, scopeKey: r.scopeKey ?? '' })),
    });

  listAccounts = async () => lambdaClient.agentQuota.listAccounts.query();

  getWindows = async (accountId: string) => lambdaClient.agentQuota.getWindows.query({ accountId });

  listBindings = async (agentId: string) => lambdaClient.agentQuota.listBindings.query({ agentId });

  /** UI "switch account": pin one account for an agent (Manual mode). */
  switchAccount = async (agentId: string, accountId: string) =>
    lambdaClient.agentQuota.switchAccount.mutate({ accountId, agentId });

  bindAccount = async (
    agentId: string,
    accountId: string,
    role: 'pinned' | 'pool' | 'disabled' = 'pool',
  ) => lambdaClient.agentQuota.bindAccount.mutate({ accountId, agentId, role });

  /** Remove a binding row entirely (drop the account from this agent's pool). */
  unbindAccount = async (bindingId: string) =>
    lambdaClient.agentQuota.unbindAccount.mutate({ id: bindingId });

  /** Edit account info (display label, enabled flag). */
  updateAccount = async (id: string, value: { enabled?: boolean; label?: string }) =>
    lambdaClient.agentQuota.updateAccount.mutate({ id, value });

  /** Who the load balancer would pick right now (Auto mode preview + reason). */
  selectAccountForAgent = async (agentId: string, modelScope?: string) =>
    lambdaClient.agentQuota.selectAccountForAgent.query({ agentId, modelScope });
}

export const agentQuotaService = new AgentQuotaService();
