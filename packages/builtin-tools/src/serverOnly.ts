import { McpEventsIdentifier } from '@lobechat/builtin-tool-mcp-events';
import { WebhookIdentifier } from '@lobechat/builtin-tool-webhook';
import { WorkIdentifier } from '@lobechat/builtin-tool-work';

/**
 * Builtin tools only the server runtime can execute: they have no browser executor (their work
 * needs the database and stored credentials). A run the browser drives itself (no agent gateway,
 * or gateway mode turned off) leaves them out, or a call would come back empty.
 */
export const serverOnlyToolIds: readonly string[] = [
  McpEventsIdentifier,
  WebhookIdentifier,
  WorkIdentifier,
];
