import { createDryRunAudit } from '@lobechat/builtin-tool-dashboard';
import type { DynamicInterventionResolver, UserToolConfig } from '@lobechat/types';

import { UserModel } from '@/database/models/user';
import { WidgetModel } from '@/database/models/widget';
import type { LobeChatDatabase } from '@/database/type';

/**
 * The `dryRunWidget` approval audit for a server agent run: reads the exact
 * version the call names, as the run's user, and asks for approval when it
 * declares connector credentials or network hosts that none of the user's
 * standing grants covers. Unreadable → approval.
 */
export const createWidgetDryRunAudit = (
  db: LobeChatDatabase,
  userId: string,
  workspaceId?: string,
): DynamicInterventionResolver => {
  const widgets = new WidgetModel(db, userId, workspaceId);
  const users = new UserModel(db, userId);
  return createDryRunAudit({
    loadGrants: async () => {
      const settings = await users.getUserSettings();
      return (settings?.tool as UserToolConfig | null | undefined)?.widgetDryRunGrants;
    },
    loadVersion: async (widgetId, versionId) => widgets.findVersion(widgetId, versionId),
  });
};
