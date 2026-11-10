import {
  HETERO_EXEC_INHERIT_PROCESS_GROUP_ENV,
  stripInheritedRunIdentity,
} from '@lobechat/heterogeneous-agents/protocol';

import { withEmbeddedCliEnv } from '@/modules/cliEmbedding';

export interface LhHeteroExecEnvParams {
  /** Account-routing env (`CLAUDE_CONFIG_DIR` of the routed login), if any. */
  accountEnv?: Record<string, string>;
  agentId?: string;
  assistantMessageId?: string;
  jwt: string;
  operationId: string;
  /** Network-proxy env from the desktop settings. */
  proxyEnv: Record<string, string>;
  serverUrl: string;
  topicId: string;
  /** Topic/run workspace — forwarded as `LOBEHUB_WORKSPACE_ID` for ingest. */
  workspaceId?: string;
}

/** Env for the embedded `lh hetero exec` a gateway-dispatched run spawns. */
export const buildLhHeteroExecEnv = (params: LhHeteroExecEnvParams) => ({
  // Never inherit the launcher's run identity (or JWT file) for a dispatched run.
  ...withEmbeddedCliEnv(stripInheritedRunIdentity(process.env)),
  ...params.proxyEnv,
  ELECTRON_RUN_AS_NODE: '1',
  [HETERO_EXEC_INHERIT_PROCESS_GROUP_ENV]: '1',
  ...(params.agentId ? { LOBEHUB_AGENT_ID: params.agentId } : {}),
  LOBEHUB_JWT: params.jwt,
  LOBEHUB_OPERATION_ID: params.operationId,
  LOBEHUB_TOPIC_ID: params.topicId,
  ...(params.assistantMessageId ? { LOBEHUB_ASSISTANT_MESSAGE_ID: params.assistantMessageId } : {}),
  LOBEHUB_SERVER: params.serverUrl,
  // Same reason `runHeteroTask` injects this for notify: without it the
  // CLI's heteroIngest/heteroFinish fall back to personal scope and the
  // workspace topic 404s (empty assistant, topic stuck `running`).
  ...(params.workspaceId ? { LOBEHUB_WORKSPACE_ID: params.workspaceId } : {}),
  ...params.accountEnv,
});
