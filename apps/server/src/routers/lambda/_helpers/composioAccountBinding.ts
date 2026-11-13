import { TRPCError } from '@trpc/server';

import type { ConnectorModel } from '@/database/models/connector';
import type { PluginModel } from '@/database/models/plugin';

import { assertConnectorMaintainable } from './connectorManagePolicy';

type ComposioAccountCtx = Parameters<typeof assertConnectorMaintainable>[0] & {
  connectorModel: Pick<ConnectorModel, 'queryComposioAccountHolders'>;
};

/**
 * Why the caller may not act on a Composio account (delete it remotely, or
 * point a connector at it) through `target`, the connector row their request
 * was authorized on; `undefined` when they may.
 *
 * The account is resolved on its own, by id. The identifier a request also
 * names is the caller's to choose, and every member reads the account ids of
 * the workspace-wide plugin projection. The Composio client deletes an account
 * by its id alone, so the remote delete reaches every row that runs it:
 *
 * - an account a teammate's private connector holds is that member's, even
 *   when a row of the caller's names it too (a connector's metadata is
 *   client-written);
 * - an account other rows hold is acted on only through one of them, and only
 *   when the caller may maintain each of them;
 * - an account no row holds is a legacy connection, which exists only as a
 *   plugin projection row of the app (`loadLegacyMirrors`). A write that has
 *   no legacy connection to act on (an agent's, which has no projection)
 *   omits it, and such an account is refused.
 */
export const findComposioAccountConflict = async (
  ctx: ComposioAccountCtx,
  target: { id: string } | null,
  connectedAccountId: string,
  loadLegacyMirrors?: () => ReturnType<PluginModel['queryComposioMirrors']>,
): Promise<TRPCError | undefined> => {
  const holders = await ctx.connectorModel.queryComposioAccountHolders(connectedAccountId);

  if (holders.some((row) => row.visibility === 'private' && row.userId !== ctx.userId)) {
    return new TRPCError({
      code: 'FORBIDDEN',
      message: 'This Composio connection belongs to another member’s private connector',
    });
  }

  if (holders.length === 0) {
    const mirrors = loadLegacyMirrors ? await loadLegacyMirrors() : [];
    const isLegacy = mirrors.some(
      (mirror) => mirror.customParams?.composio?.connectedAccountId === connectedAccountId,
    );
    if (isLegacy) return;
    return new TRPCError({
      code: 'NOT_FOUND',
      message: 'This Composio connection is not one of this connector’s connections',
    });
  }

  if (!target || !holders.some((row) => row.id === target.id)) {
    return new TRPCError({
      code: 'FORBIDDEN',
      message: 'This Composio connection belongs to a different connector',
    });
  }

  for (const row of holders) {
    if (row.id === target.id) continue;
    try {
      await assertConnectorMaintainable(ctx, row);
    } catch (error) {
      if (error instanceof TRPCError) return error;
      throw error;
    }
  }
};
