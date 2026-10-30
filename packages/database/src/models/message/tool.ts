import type { ChatToolPayload, HeterogeneousToolStateSnapshot } from '@lobechat/types';
import { and, eq, sql } from 'drizzle-orm';

import { merge } from '@/utils/merge';
import { sanitizeNullBytes } from '@/utils/sanitizeNullBytes';

import { messagePlugins, messages } from '../../schemas';
import { MessageScope } from './scope';

export class MessageToolMutations extends MessageScope {
  /**
   * Update tool message with content, metadata, pluginState, and pluginError in a single transaction
   * This prevents race conditions when updating multiple fields
   */
  updateToolMessage = async (
    id: string,
    params: {
      content?: string;
      heterogeneousToolState?: HeterogeneousToolStateSnapshot;
      metadata?: Record<string, any>;
      pluginError?: any;
      pluginState?: Record<string, any>;
      /** Replace rather than merge when withholding a complete tool result. */
      replacePluginState?: boolean;
      /** Finalize a deferred placeholder once; later callbacks cannot replace its result. */
      onlyIfEmpty?: boolean;
    },
  ): Promise<{ applied: boolean; snapshotSeq?: number; success: boolean }> => {
    const {
      content,
      heterogeneousToolState,
      metadata,
      pluginState,
      pluginError,
      replacePluginState,
    } = params;

    // `undefined` while no branch has looked for the row yet; see `update` above
    // for why a write that matches nothing must not report success.
    let matchedRow: boolean | undefined;
    let applied = true;
    let snapshotSeq: number | undefined;

    try {
      await this.db.transaction(async (trx) => {
        if (params.onlyIfEmpty) {
          const [message] = await trx
            .select({ content: messages.content })
            .from(messages)
            .where(and(eq(messages.id, id), this.ownership()))
            .for('update');
          matchedRow = !!message;
          if (!message) return;
          if (message.content) {
            applied = false;
            return;
          }
        }

        let existingMetadata: Record<string, any> | undefined;

        if (metadata !== undefined || heterogeneousToolState !== undefined) {
          const baseQuery = trx
            .select({ metadata: messages.metadata })
            .from(messages)
            .where(and(eq(messages.id, id), this.ownership()))
            .limit(1);
          const [existingMessage] = heterogeneousToolState
            ? await baseQuery.for('update')
            : await baseQuery;

          matchedRow = !!existingMessage;
          if (!existingMessage) return;

          existingMetadata = (existingMessage.metadata ?? {}) as Record<string, any>;

          if (heterogeneousToolState) {
            const currentOperationId = existingMetadata.heterogeneousToolStateOperationId;
            const rawCurrentSeq = existingMetadata.heterogeneousToolStateSeq;
            const currentSeq =
              currentOperationId === heterogeneousToolState.operationId &&
              typeof rawCurrentSeq === 'number' &&
              Number.isFinite(rawCurrentSeq)
                ? rawCurrentSeq
                : 0;

            if (heterogeneousToolState.snapshotSeq <= currentSeq) {
              applied = false;
              snapshotSeq = currentSeq;
              return;
            }

            snapshotSeq = heterogeneousToolState.snapshotSeq;
          }
        }

        // Update messages table (content, metadata)
        if (
          content !== undefined ||
          metadata !== undefined ||
          heterogeneousToolState !== undefined
        ) {
          const messageUpdateData: Record<string, any> = {};

          if (content !== undefined) {
            messageUpdateData.content = sanitizeNullBytes(content);
          }

          if (metadata !== undefined || heterogeneousToolState !== undefined) {
            const mergedMetadata = merge(existingMetadata || {}, metadata || {});
            messageUpdateData.metadata = heterogeneousToolState
              ? merge(mergedMetadata, {
                  heterogeneousToolStateOperationId: heterogeneousToolState.operationId,
                  heterogeneousToolStateSeq: heterogeneousToolState.snapshotSeq,
                })
              : mergedMetadata;
          }

          /* v8 ignore else -- unreachable: the outer guard means `content` or `metadata` was assigned above */
          if (Object.keys(messageUpdateData).length > 0) {
            const [updated] = await trx
              .update(messages)
              .set(messageUpdateData)
              .where(and(eq(messages.id, id), this.ownership()))
              .returning({ id: messages.id });

            matchedRow = !!updated;
          }
        }

        // Update messagePlugins table (pluginState, pluginError)
        if (pluginState !== undefined || pluginError !== undefined) {
          const pluginUpdateData: Record<string, any> = {};

          if (pluginState !== undefined) {
            const sanitizedState = sanitizeNullBytes(pluginState);
            // Snapshot writes replace the whole runtime state. Ordinary patches
            // own complete top-level keys and merge inside the UPDATE so an
            // answer write cannot race away an intervention-terminal write.
            pluginUpdateData.state =
              heterogeneousToolState || replacePluginState
                ? sanitizedState
                : sql`coalesce(${messagePlugins.state}, '{}'::jsonb) || ${JSON.stringify(sanitizedState)}::jsonb`;
          }

          if (pluginError !== undefined) {
            pluginUpdateData.error = sanitizeNullBytes(pluginError);
          }

          const [updatedPlugin] = await trx
            .update(messagePlugins)
            .set(pluginUpdateData)
            .where(and(eq(messagePlugins.id, id), this.pluginsOwnership()))
            .returning({ id: messagePlugins.id });

          // A plugin-only patch never touches `messages`, so the plugin row is
          // the only evidence the tool message exists.
          if (matchedRow === undefined) matchedRow = !!updatedPlugin;

          if (!updatedPlugin && heterogeneousToolState) {
            throw new Error(`No tool plugin matched id ${id}`);
          }
        }
      });

      if (matchedRow === false) {
        console.error(`Update tool message error: no tool message matched id ${id}`);
        return { applied: false, success: false };
      }

      return { applied, snapshotSeq, success: true };
    } catch (error) {
      console.error('Update tool message error:', error);
      return { applied: false, success: false };
    }
  };

  /**
   * Update tool arguments by toolCallId - updates both tool message plugin.arguments
   * and parent assistant message tools[].arguments in a single transaction
   *
   * This method uses toolCallId (the stable identifier from AI response) instead of
   * tool message ID, which allows updating arguments even when the tool message
   * hasn't been persisted yet (e.g., during intervention pending state).
   *
   * @param toolCallId - The tool call ID (stable identifier from AI response)
   * @param args - The new arguments string (already stringified JSON)
   */
  updateToolArguments = async (toolCallId: string, args: string): Promise<{ success: boolean }> => {
    try {
      await this.db.transaction(async (trx) => {
        // 1. Find tool plugin and tool message with parentId in one query
        const [toolResult] = await trx
          .select({
            parentId: messages.parentId,
            toolPluginId: messagePlugins.id,
          })
          .from(messagePlugins)
          .innerJoin(messages, eq(messages.id, messagePlugins.id))
          .where(and(eq(messagePlugins.toolCallId, toolCallId), this.ownership()))
          .limit(1);

        if (!toolResult?.parentId) {
          throw new Error(`No tool message found with toolCallId: ${toolCallId}`);
        }

        // 2. Get parent assistant message's tools
        const [parentMessage] = await trx
          .select({ id: messages.id, tools: messages.tools })
          .from(messages)
          .where(and(eq(messages.id, toolResult.parentId), this.ownership()))
          .limit(1);

        if (!parentMessage?.tools) {
          throw new Error(`No parent assistant message found for toolCallId: ${toolCallId}`);
        }

        const parentTools = parentMessage.tools as ChatToolPayload[];

        // 3. Update the parent assistant message's tools[].arguments
        const updatedTools = parentTools.map((tool) => {
          if (tool.id === toolCallId) {
            return { ...tool, arguments: args };
          }
          return tool;
        });

        // Execute both updates in parallel
        await Promise.all([
          // Update tool plugin arguments
          trx
            .update(messagePlugins)
            .set({ arguments: args })
            .where(and(eq(messagePlugins.id, toolResult.toolPluginId), this.pluginsOwnership())),
          // Update parent assistant message's tools
          trx
            .update(messages)
            .set({ tools: updatedTools })
            .where(and(eq(messages.id, parentMessage.id), this.ownership())),
        ]);
      });

      return { success: true };
    } catch (error) {
      console.error('Update tool arguments error:', error);
      return { success: false };
    }
  };
}
