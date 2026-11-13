import { memoize } from 'es-toolkit';

import type { InboundWebhookQuery, InboundWebhookView } from '@/database/models/inboundWebhook';
import { InboundWebhookModel } from '@/database/models/inboundWebhook';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { isMcpEventsEnabled } from '@/server/services/mcp/featureGate';

import { getInboundWebhookKind } from './kinds';
import { maintenanceBackoff } from './kinds/mcpEvents/subscription';

/** Hide the endpoint before contacting the upstream; failures remain durable for the sweep. */
export async function removeInboundWebhook(
  db: LobeChatDatabase,
  row: InboundWebhookView,
): Promise<void> {
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  const model = new InboundWebhookModel(db, row.userId, row.workspaceId ?? undefined, gateKeeper);
  await model.update(row.id, { status: 'deleting' });
  try {
    await getInboundWebhookKind(row.kind)?.teardown?.({ db, model, row });
    await model.delete(row.id);
  } catch {
    console.error('[inboundWebhook:delete] Remote teardown failed', row.id);
    const failures = row.maintenanceFailures + 1;
    if (failures >= 5) await model.delete(row.id);
    else
      await model.update(row.id, {
        maintenanceFailures: failures,
        nextMaintenanceAt: new Date(Date.now() + maintenanceBackoff(failures)),
        status: 'deleting',
      });
  }
}

async function removeMatching(
  db: LobeChatDatabase,
  scope: { userId: string; workspaceId?: string },
  filter: InboundWebhookQuery,
) {
  const rows = await new InboundWebhookModel(db, scope.userId, scope.workspaceId).query({
    ...filter,
    includeHidden: true,
  });
  for (const row of rows) {
    if (row.status !== 'deleting') await removeInboundWebhook(db, row);
  }
}
export const removeByConnector = (
  db: LobeChatDatabase,
  scope: { userId: string; workspaceId?: string },
  connectorId: string,
) => removeMatching(db, scope, { connectorId });
export const removeByAgent = (
  db: LobeChatDatabase,
  scope: { userId: string; workspaceId?: string },
  agentId: string,
) => removeMatching(db, scope, { agentId });
export async function removeByTopics(
  db: LobeChatDatabase,
  scope: { userId: string; workspaceId?: string },
  topicIds: string[],
) {
  for (const topicId of topicIds) await removeMatching(db, scope, { topicId });
}

/** Credentials changed, including no-expiry subscriptions which have no scheduled refresh. */
export async function refreshByConnector(
  db: LobeChatDatabase,
  scope: { userId: string; workspaceId?: string },
  connectorId: string,
) {
  const eventsEnabledFor = memoize(isMcpEventsEnabled);
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  const rows = await new InboundWebhookModel(db, scope.userId, scope.workspaceId).query({
    connectorId,
  });
  for (const row of rows) {
    if (row.status === 'terminated') continue;
    if (row.kind === 'mcp_events' && !(await eventsEnabledFor(row.userId))) continue;
    const model = new InboundWebhookModel(db, row.userId, row.workspaceId ?? undefined, gateKeeper);
    await getInboundWebhookKind(row.kind)?.maintain?.({ db, featureEnabled: true, model, row });
  }
}
