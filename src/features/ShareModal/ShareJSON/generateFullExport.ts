import { type ChatTopic, type ExportedTopic, type UIChatMessage } from '@lobechat/types';
import { cleanObject } from '@lobechat/utils';

import { LOADING_FLAT } from '@/const/message';

import { type BaseExportOptions } from './type';

interface FullExportParams extends BaseExportOptions {
  messages: UIChatMessage[];
  systemRole: string;
  topic?: ChatTopic;
}

/**
 * Generates a lossless export of topic data including all message metadata
 */
export const generateFullExport = ({
  topic,
  messages,
  systemRole,
  withSystemRole,
}: FullExportParams): ExportedTopic => {
  const exportedMessages: Record<string, any>[] = messages
    .filter((m) => m.content !== LOADING_FLAT)
    .map((m) =>
      /* eslint-disable sort-keys-fix/sort-keys-fix */
      cleanObject({
        // Core fields
        content: m.content,
        createdAt: new Date(m.createdAt).toISOString(),
        error: m.error,
        id: m.id,
        model: m.model,
        parentId: m.parentId,
        provider: m.provider,
        role: m.role,
        updatedAt: new Date(m.updatedAt).toISOString(),

        // Tool/Plugin fields
        plugin: m.plugin,
        pluginError: m.pluginError,
        pluginIntervention: m.pluginIntervention,
        pluginState: m.pluginState,
        tool_call_id: m.tool_call_id,
        tools: m.tools,

        // Extended fields
        metadata: m.metadata,
        reasoning: m.reasoning,
        search: m.search,
        traceId: m.traceId,
      }),
    );

  // Add system role as a separate message if requested
  if (withSystemRole && !!systemRole) {
    const now = new Date().toISOString();
    exportedMessages.unshift({
      content: systemRole,
      createdAt: now,
      id: 'system-role',
      role: 'system',
      updatedAt: now,
    });
  }

  return cleanObject({
    version: '2.0',
    title: topic?.title,
    messages: exportedMessages,
    exportedAt: new Date().toISOString(),
  });
};
