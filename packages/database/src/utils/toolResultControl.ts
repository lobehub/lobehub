import { isRecord } from '@lobechat/utils/object';
import {
  BLOCKED_TOOL_RESULT_CONTENT,
  PENDING_TOOL_RESULT_CONTENT,
  pickToolResultUsage,
} from '@lobechat/utils/toolResultControl';
import { sql, type SQLWrapper } from 'drizzle-orm';

interface ResultMessage {
  content?: string | null;
  metadata?: unknown;
  pluginState?: unknown;
  role?: string | null;
}

/**
 * Shared read boundary for normal history, grouped history, direct tool reads,
 * and transcript exports. Private result data remains available to the server
 * policy evaluator through findById/findMessagePlugin only.
 */
export function projectToolResultControl<T extends ResultMessage>(message: T): T {
  if (!isRecord(message.metadata) || !message.metadata.toolResultControl) return message;
  const { toolResultControl, ...metadata } = message.metadata;
  const review = isRecord(toolResultControl) ? toolResultControl : {};
  if (message.role !== 'tool' || review.status === 'allowed') return { ...message, metadata };
  const blocked = review.status === 'blocked';
  const content = blocked ? BLOCKED_TOOL_RESULT_CONTENT : PENDING_TOOL_RESULT_CONTENT;
  return {
    ...message,
    content,
    metadata: {},
    pluginError: blocked ? 'hook_denied' : undefined,
    pluginState: {
      ...(blocked && pickToolResultUsage(message.pluginState)),
      phase: 'afterToolCall',
      reason: content,
      type: blocked ? 'blocked' : 'pending',
    },
    audioList: undefined,
    chunksList: undefined,
    editorData: undefined,
    error: undefined,
    extra: undefined,
    fileList: undefined,
    imageList: undefined,
    ragQuery: undefined,
    ragRawQuery: undefined,
    reasoning: undefined,
    search: undefined,
    videoList: undefined,
    works: undefined,
  };
}

/** A stale UI metadata snapshot must never overwrite the current gate status. */
export function preserveToolResultControl(current: SQLWrapper, patch: Record<string, unknown>) {
  const { toolResultControl: _review, ...ordinary } = patch;
  return sql`${JSON.stringify(ordinary)}::jsonb || case
    when coalesce(${current}, '{}'::jsonb) ? 'toolResultControl'
    then jsonb_build_object('toolResultControl', ${current}->'toolResultControl')
    else '{}'::jsonb end`;
}
