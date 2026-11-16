import type { GenericWebhookTopicMode, InboundWebhookStatus } from '@lobechat/types';
import { isInboundWebhookOfKind } from '@lobechat/types';

import type { InboundWebhookView, InboundWebhookViewOf } from '@/database/models/inboundWebhook';
import { InboundWebhookModel } from '@/database/models/inboundWebhook';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { receiveInboundWebhook } from '../../receiver';
import { generateWebhookToken } from './token';

export interface GenericWebhookSettings {
  autoApprove?: boolean;
  instructions?: string | null;
  name?: string | null;
  /** `reuse` only: an existing Topic of the agent to continue; null clears it. */
  topicId?: string | null;
  topicMode?: GenericWebhookTopicMode;
}

export class GenericWebhookError extends Error {
  constructor(
    readonly code: 'invalid_topic' | 'not_generic' | 'not_found',
    message: string,
  ) {
    super(message);
    this.name = 'GenericWebhookError';
  }
}

const clean = (value: string | null | undefined) => value?.trim() || null;

/**
 * The Topic a `reuse` webhook continues, checked against the agent and the creator: runs go out
 * as the creator, so only their own Topic of that agent can be picked. `new` keeps none.
 */
const pinnedTopic = async (
  db: LobeChatDatabase,
  scope: { userId: string; workspaceId?: string },
  agentId: string,
  topicMode: GenericWebhookTopicMode,
  topicId: string | null | undefined,
): Promise<string | undefined> => {
  if (topicMode !== 'reuse' || !topicId) return undefined;
  const topic = await new TopicModel(db, scope.userId, scope.workspaceId).findById(topicId);
  if (!topic || topic.agentId !== agentId || topic.userId !== scope.userId)
    throw new GenericWebhookError('invalid_topic', 'Pick one of your own topics of this agent.');
  return topic.id;
};

/** Model scoped to the row's creator, with a gatekeeper: secrets are read and written as theirs. */
const ownerModel = async (db: LobeChatDatabase, row: InboundWebhookView) =>
  new InboundWebhookModel(
    db,
    row.userId,
    row.workspaceId ?? undefined,
    await KeyVaultsGateKeeper.initWithEnvKey(),
  );

export const asGeneric = (row: InboundWebhookView | undefined): InboundWebhookViewOf<'generic'> => {
  if (!row || row.status === 'deleting' || row.status === 'pending')
    throw new GenericWebhookError('not_found', 'Webhook not found.');
  if (!isInboundWebhookOfKind(row, 'generic'))
    throw new GenericWebhookError('not_generic', 'Only generic webhooks can be changed here.');
  return row;
};

/**
 * Create a generic webhook for `agentId`, active at once, with a fresh key. The key comes back
 * only here and from {@link rotateGenericWebhookToken}: it is stored encrypted and never shown
 * again.
 */
export async function createGenericWebhook(
  db: LobeChatDatabase,
  scope: { userId: string; workspaceId?: string },
  input: GenericWebhookSettings & { agentId: string },
) {
  const model = new InboundWebhookModel(
    db,
    scope.userId,
    scope.workspaceId,
    await KeyVaultsGateKeeper.initWithEnvKey(),
  );
  const token = generateWebhookToken();
  const topicMode = input.topicMode ?? 'new';
  const topicId = await pinnedTopic(db, scope, input.agentId, topicMode, input.topicId);
  const row = await model.createWithLimits({
    agentId: input.agentId,
    config: { autoApprove: input.autoApprove ?? false, topicMode, ...(topicId && { topicId }) },
    instructions: clean(input.instructions),
    kind: 'generic',
    name: clean(input.name),
    secret: token,
    // Generic webhooks have no handshake; `pending` would be refused and swept away.
    status: 'active',
    verification: { scheme: 'bearer_token' },
  });
  return { row: asGeneric(row), secret: token };
}

/** Change a generic webhook's settings, or pause / resume it. */
export async function updateGenericWebhook(
  db: LobeChatDatabase,
  row: InboundWebhookViewOf<'generic'>,
  input: GenericWebhookSettings & { paused?: boolean },
) {
  const model = await ownerModel(db, row);
  let status: InboundWebhookStatus | undefined;
  if (input.paused === true) status = 'paused';
  else if (input.paused === false && row.status === 'paused') status = 'active';
  let config: typeof row.config | undefined;
  if (
    input.autoApprove !== undefined ||
    input.topicMode !== undefined ||
    input.topicId !== undefined
  ) {
    const topicMode = input.topicMode ?? row.config.topicMode;
    const topicId = await pinnedTopic(
      db,
      { userId: row.userId, workspaceId: row.workspaceId ?? undefined },
      row.agentId,
      topicMode,
      input.topicId === undefined ? row.config.topicId : input.topicId,
    );
    config = {
      autoApprove: input.autoApprove ?? row.config.autoApprove,
      topicMode,
      ...(topicId && { topicId }),
    };
  }
  const updated = await model.update(row.id, {
    ...(config && { config }),
    ...(input.instructions !== undefined && { instructions: clean(input.instructions) }),
    ...(input.name !== undefined && { name: clean(input.name) }),
    ...(status && { status }),
  });
  return asGeneric(updated);
}

/** Replace the key; the previous one stops working at once, and the URL stays as it was. */
export async function rotateGenericWebhookToken(
  db: LobeChatDatabase,
  row: InboundWebhookViewOf<'generic'>,
) {
  const token = generateWebhookToken();
  const updated = await (await ownerModel(db, row)).rotateSecret(row.id, token);
  return { row: asGeneric(updated), secret: token };
}

/**
 * Deliver a sample request through the same receiver a caller reaches, so the test shows exactly
 * what a real call would do: stored, deduplicated, and waking the Agent.
 */
export async function sendGenericWebhookTest(
  db: LobeChatDatabase,
  row: InboundWebhookViewOf<'generic'>,
) {
  const secret = await (await ownerModel(db, row)).getSecret(row.id);
  if (!secret) throw new GenericWebhookError('not_found', 'Webhook not found.');
  const result = await receiveInboundWebhook(db, {
    body: JSON.stringify({
      message: 'This is a test delivery sent from the webhook settings.',
      sentAt: new Date().toISOString(),
    }),
    headers: new Headers({
      'authorization': `Bearer ${secret}`,
      'content-type': 'application/json',
      'user-agent': 'LobeHub-Test',
    }),
    id: row.id,
    test: true,
  });
  return {
    accepted: result.status === 200 || result.status === 202,
    error: typeof result.body.error === 'string' ? result.body.error : undefined,
    status: result.status,
  };
}
