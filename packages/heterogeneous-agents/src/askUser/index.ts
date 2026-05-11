/**
 * Producer-side MCP server + per-op bridge for Claude Code's AskUserQuestion
 * via local HTTP MCP. See `LOBE-8725` for the full design.
 *
 * Used by:
 *   - Electron main (`HeterogeneousAgentCtr`) — local app
 *   - Sandbox CLI (`lh hetero exec`) — phase 2; for now the CLI doesn't
 *     register a server and CC falls back to text questions
 *
 * Consumer (renderer / web client) talks to the producer via the existing
 * `AgentStreamEvent` pipeline — `agent_intervention_request` flows out,
 * `agent_intervention_response` flows back.
 */
export {
  AskUserBridge,
  type InterventionAnswer,
  type PendingArgs,
  type PendingOptions,
} from './AskUserBridge';
export {
  AskUserMcpServer,
  type AskUserMcpServerOptions,
  type StartedServer,
} from './AskUserMcpServer';
export {
  ASK_USER_API_NAME,
  ASK_USER_MCP_SERVER_NAME,
  ASK_USER_TOOL_FULL_NAME,
  ASK_USER_TOOL_NAME,
} from './constants';
