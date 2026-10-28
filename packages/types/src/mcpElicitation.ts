import type { ElicitRequestParams } from '@modelcontextprotocol/client';

/** Public interaction projection. Private MCP requestState and form answers stay server-side. */
export interface PendingMcpElicitation {
  apiName: string;
  assistantMessageId: string;
  batchId: string;
  deadline: number;
  id: string;
  identifier: string;
  operationId: string;
  requests: Record<string, ElicitRequestParams>;
  resolving: boolean;
  serverName?: string;
  toolCallId: string;
  toolMessageId: string;
}
