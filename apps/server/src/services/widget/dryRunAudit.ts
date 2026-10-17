import { createDryRunAudit } from '@lobechat/builtin-tool-dashboard';
import type { DynamicInterventionResolver } from '@lobechat/types';

import { WidgetModel } from '@/database/models/widget';
import type { LobeChatDatabase } from '@/database/type';

/**
 * The `dryRunWidget` approval audit for a server agent run: reads the exact
 * version the call names, as the run's user, and asks for approval when it
 * declares connector credentials or network hosts. Unreadable → approval.
 */
export const createWidgetDryRunAudit = (
  db: LobeChatDatabase,
  userId: string,
  workspaceId?: string,
): DynamicInterventionResolver => {
  const widgets = new WidgetModel(db, userId, workspaceId);
  return createDryRunAudit({
    loadVersion: async (widgetId, versionId) => widgets.findVersion(widgetId, versionId),
  });
};
