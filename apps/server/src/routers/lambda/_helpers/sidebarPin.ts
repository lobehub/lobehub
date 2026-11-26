import { TRPCError } from '@trpc/server';

import { WorkspaceUserSettingsModel } from '@/database/models/workspaceUserSettings';
import { MAX_PINNED_ORDER_ITEMS } from '@/database/repositories/home/pinnedOrder';
import type { LobeChatDatabase } from '@/database/type';
import { getWorkspaceScopedPermissionMatches } from '@/server/services/workspacePermission';

/**
 * Upper bound for one member's pin list in a workspace. It may be seeded with
 * every team pin, so this matches the team order cap.
 */
export const MAX_SIDEBAR_PINNED_ITEMS = MAX_PINNED_ORDER_ITEMS;

/**
 * When the workspace sidebar stopped showing team pins to every member and
 * started recommending Agents instead (lobehub/lobehub#23520). Members who
 * joined before keep the team pins as their own pins the first time their
 * sidebar is set up; members who join later start from the recommended
 * Agents, unpinned. A member who joined between this date and the deploy
 * reaching their server is treated as new, which is the intended behavior
 * anyway.
 */
export const TEAM_PINS_RETIRED_AT = new Date('2026-11-24T00:00:00Z');

export const RECOMMENDED_AGENTS_FORBIDDEN_MESSAGE =
  'Only workspace owners and admins can change recommended agents';

export const TEAM_PIN_FORBIDDEN_MESSAGE = 'Only workspace owners and admins can change team pins';

interface TeamPinCtx {
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
}

/**
 * In a workspace, `pinned` on a PUBLIC Agent / chat group is a legacy team
 * pin (still read for members who joined while it was shown, and as the
 * recommended Agents until a list is saved), so only roles holding
 * the all-resource `agent:update` grant (owner, admin) may write it. Members
 * pin for themselves through `workspace_user_settings.sidebarPinnedItemIds`.
 * Personal mode and private rows (only their creator can see them) are not
 * team pins and skip this check. The workspace's recommended Agents list is
 * gated the same way (pass {@link RECOMMENDED_AGENTS_FORBIDDEN_MESSAGE}).
 */
export const assertCanWriteTeamPin = async (
  ctx: TeamPinCtx,
  message = TEAM_PIN_FORBIDDEN_MESSAGE,
): Promise<void> => {
  if (!ctx.workspaceId) return;

  const { hasAllScope } = await getWorkspaceScopedPermissionMatches({
    action: 'AGENT_UPDATE',
    db: ctx.serverDB,
    // Injected by the Cloud workspace auth middleware; resolved from the DB otherwise.
    grantedPermissions: (ctx as { workspacePermissionCodes?: string[] }).workspacePermissionCodes,
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
  });

  if (!hasAllScope) {
    throw new TRPCError({ code: 'FORBIDDEN', message });
  }
};

/**
 * A private row's `pinned` column is its creator's own pin. Once the row is
 * published that column would read as a team pin no owner/admin chose, so the
 * pin moves to the creator's personal list and the column is cleared: the
 * creator keeps it pinned, nobody else gets it pinned. Callers run this BEFORE
 * flipping visibility. The personal entry is written first, so a failure at
 * any step leaves the pin either on the column of a still-private row or in
 * the personal list — never as an unauthorized team pin, never lost.
 */
export const releasePrivatePin = async ({
  clearPinned,
  creatorId,
  db,
  itemId,
  workspaceId,
}: {
  clearPinned: () => Promise<unknown>;
  creatorId: string;
  db: LobeChatDatabase;
  itemId: string;
  workspaceId: string;
}): Promise<void> => {
  const model = new WorkspaceUserSettingsModel(db, creatorId, workspaceId);
  const current = (await model.getPreference()).sidebarPinnedItemIds ?? [];
  if (!current.includes(itemId)) {
    await model.updatePreference({
      sidebarPinnedItemIds: [itemId, ...current].slice(0, MAX_SIDEBAR_PINNED_ITEMS),
    });
  }
  await clearPinned();
};
