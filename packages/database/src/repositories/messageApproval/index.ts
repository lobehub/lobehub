import { merge } from '@/utils/merge';

import { MessageLookupQueries } from '../../models/message/lookup';
import { HumanApprovalAlreadyResolvedError, MessagePluginStore } from '../../models/message/plugin';
import type { MessageScopeArgs } from '../../models/message/scope';
import type { HumanApprovalResolution, MessageModelOptions } from '../../models/message/types';
import { MessageWriteMutations } from '../../models/message/write';
import type { LobeChatDatabase } from '../../type';

/**
 * Human-approval claim and rollback for a batch of parked tool messages, as one
 * unit of work.
 *
 * A claim locks and writes both the message roots (published tool content) and
 * their `message_plugins` rows (intervention / state / error), so the
 * transaction lives here and composes the single-table pieces of
 * `MessageWriteMutations` and `MessagePluginStore`, each bound to the
 * transaction. `MessageModel.resolveHumanApproval` / `restoreHumanApproval`
 * forward to this repository.
 */
export class MessageApprovalRepo {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
    private readonly options: MessageModelOptions = {},
  ) {}

  private stores = (trx: LobeChatDatabase) => {
    const args: MessageScopeArgs = [trx, this.userId, this.workspaceId, undefined, this.options];
    return {
      messages: new MessageWriteMutations(...args),
      plugins: new MessagePluginStore(args, { lookups: new MessageLookupQueries(...args) }),
    };
  };

  /**
   * Resolve an approval batch at one row-locking boundary. Every target is
   * checked before any write, so Web, Mobile, Stop, and notification actions
   * cannot each win a subset of the same assistant turn. Source adapters claim
   * only; content/state remain in their private resolution until the runtime
   * passes publishResult after afterToolCall. Stop may publish its fixed receipt.
   */
  resolve = async (
    resolutions: HumanApprovalResolution[],
    options: { publishResult?: boolean } = {},
  ): Promise<'applied' | 'idempotent'> => {
    if (resolutions.length === 0) return 'idempotent';

    const ids = resolutions.map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      throw new Error('Human approval batch contains duplicate tool messages');
    }

    return this.db.transaction(async (trx) => {
      const stores = this.stores(trx as LobeChatDatabase);
      // Match deferred completion's lock order (message before plugin).
      const lockedMessages = await stores.messages.lockContentForUpdate(ids);
      const messagesById = new Map(lockedMessages.map((row) => [row.id, row]));
      const lockedRows = await stores.plugins.lockApprovalPluginsForUpdate(ids);
      const lockedById = new Map(lockedRows.map((row) => [row.id, row]));

      const rowStates = resolutions.map((resolution) => {
        const row = lockedById.get(resolution.id);
        if (!row) throw new Error(`Plugin not found: ${resolution.id}`);
        if (row.intervention?.status === 'pending') return 'pending' as const;

        const sameRequest =
          Boolean(resolution.intervention.resolutionRequestId) &&
          row.intervention?.resolutionRequestId === resolution.intervention.resolutionRequestId;
        const sameDecision = Object.entries(resolution.intervention).every(
          ([key, value]) =>
            JSON.stringify(row.intervention?.[key as keyof typeof row.intervention]) ===
            JSON.stringify(value),
        );
        if (sameRequest && sameDecision) return 'idempotent' as const;
        throw new HumanApprovalAlreadyResolvedError(resolution.id);
      });
      const pendingCount = rowStates.filter((state) => state === 'pending').length;
      if (pendingCount === 0 && !options.publishResult) return 'idempotent';
      if (pendingCount !== 0 && pendingCount !== resolutions.length) {
        throw new Error('Human approval batch contains a partial idempotent claim');
      }

      let published = false;
      for (const resolution of resolutions) {
        // An already claimed source answer can publish exactly once. A replay
        // retains the first final content, including a hook denial.
        if (
          pendingCount === 0 &&
          (messagesById.get(resolution.id)?.content ||
            (resolution.content === undefined &&
              resolution.pluginState === undefined &&
              resolution.pluginError === undefined))
        )
          continue;
        published = true;
        const row = lockedById.get(resolution.id)!;
        if (options.publishResult && resolution.content !== undefined) {
          const updatedMessage = await stores.messages.updateContent(
            resolution.id,
            resolution.content,
          );
          if (!updatedMessage) throw new Error(`Message not found: ${resolution.id}`);
        }

        const updatedPlugin = await stores.plugins.patchApprovalPlugin(resolution.id, {
          // Status/result is a claim patch, not a replacement. Preserve the
          // authoritative operation/batch/item identity stamped when the
          // parked tool row was created so subsequent source reads, Stop,
          // and rollback still address the same sealed batch.
          intervention: merge(row.intervention || {}, resolution.intervention),
          ...(options.publishResult &&
            resolution.pluginError !== undefined && { error: resolution.pluginError }),
          ...(options.publishResult &&
            resolution.pluginState !== undefined && {
              state: resolution.replacePluginState
                ? resolution.pluginState
                : merge(row.state || {}, resolution.pluginState || {}),
            }),
        });
        if (!updatedPlugin) throw new Error(`Plugin not found: ${resolution.id}`);
      }

      return published ? 'applied' : 'idempotent';
    });
  };

  /** Restore the exact pre-claim snapshot when continuation startup fails. */
  restore = async (resolutions: HumanApprovalResolution[]): Promise<void> => {
    if (resolutions.length === 0) return;

    await this.db.transaction(async (trx) => {
      const stores = this.stores(trx as LobeChatDatabase);
      const ids = resolutions.map(({ id }) => id);
      await stores.messages.lockContentForUpdate(ids);
      const lockedRows = await stores.plugins.lockApprovalPluginsForUpdate(ids);
      const lockedById = new Map(lockedRows.map((row) => [row.id, row]));

      for (const resolution of resolutions) {
        const locked = lockedById.get(resolution.id);
        if (!locked) throw new Error(`Plugin not found: ${resolution.id}`);
        if (
          resolution.claimedResolutionRequestId &&
          locked.intervention?.resolutionRequestId !== resolution.claimedResolutionRequestId
        ) {
          continue;
        }
        if (resolution.content !== undefined) {
          const updatedMessage = await stores.messages.updateContent(
            resolution.id,
            resolution.content,
          );
          if (!updatedMessage) throw new Error(`Message not found: ${resolution.id}`);
        }
        await stores.plugins.patchApprovalPlugin(resolution.id, {
          intervention: resolution.intervention,
          ...(resolution.pluginError !== undefined && { error: resolution.pluginError }),
          ...(resolution.pluginState !== undefined && { state: resolution.pluginState }),
        });
      }
    });
  };
}
