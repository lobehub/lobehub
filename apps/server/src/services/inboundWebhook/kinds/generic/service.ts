import type { GenericWebhookTopicMode, InboundWebhookStatus } from '@lobechat/types';
import { isInboundWebhookOfKind } from '@lobechat/types';

import type { InboundWebhookView, InboundWebhookViewOf } from '@/database/models/inboundWebhook';
import { InboundWebhookModel } from '@/database/models/inboundWebhook';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { receiveInboundWebhook } from '../../receiver';
import { generateWebhookToken, genericWebhookEndpoint } from './token';

export interface GenericWebhookSettings {
  autoApprove?: boolean;
  instructions?: string | null;
  name?: string | null;
  topicMode?: GenericWebhookTopicMode;
}

export class GenericWebhookError extends Error {
  constructor(
    readonly code: 'not_generic' | 'not_found',
    message: string,
  ) {
    super(message);
    this.name = 'GenericWebhookError';
  }
}

const clean = (value: string | null | undefined) => value?.trim() || null;

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

/** Create a generic webhook for `agentId`, active at once, with a fresh secret. */
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
  const row = await model.createWithLimits({
    agentId: input.agentId,
    config: { autoApprove: input.autoApprove ?? false, topicMode: input.topicMode ?? 'new' },
    instructions: clean(input.instructions),
    kind: 'generic',
    name: clean(input.name),
    secret: token,
    // Generic webhooks have no handshake; `pending` would be refused and swept away.
    status: 'active',
    verification: { scheme: 'url_token' },
  });
  return { endpoint: genericWebhookEndpoint(row.id, token), row: asGeneric(row) };
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
  const config =
    input.autoApprove !== undefined || input.topicMode !== undefined
      ? {
          autoApprove: input.autoApprove ?? row.config.autoApprove,
          topicMode: input.topicMode ?? row.config.topicMode,
        }
      : undefined;
  const updated = await model.update(row.id, {
    ...(config && { config }),
    ...(input.instructions !== undefined && { instructions: clean(input.instructions) }),
    ...(input.name !== undefined && { name: clean(input.name) }),
    ...(status && { status }),
  });
  return asGeneric(updated);
}

/** Replace the secret; the previous URL and Bearer token stop working immediately. */
export async function rotateGenericWebhookToken(
  db: LobeChatDatabase,
  row: InboundWebhookViewOf<'generic'>,
) {
  const token = generateWebhookToken();
  const updated = await (await ownerModel(db, row)).rotateSecret(row.id, token);
  return { endpoint: genericWebhookEndpoint(row.id, token), row: asGeneric(updated) };
}

/** Full call URLs of `rows` that are generic, keyed by id; others are left out. */
export async function genericWebhookEndpoints(
  db: LobeChatDatabase,
  rows: InboundWebhookView[],
): Promise<Map<string, string>> {
  const endpoints = new Map<string, string>();
  const generic = rows.filter((row) => isInboundWebhookOfKind(row, 'generic'));
  if (!generic.length) return endpoints;
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  for (const row of generic) {
    const secret = await new InboundWebhookModel(
      db,
      row.userId,
      row.workspaceId ?? undefined,
      gateKeeper,
    ).getSecret(row.id);
    if (secret) endpoints.set(row.id, genericWebhookEndpoint(row.id, secret));
  }
  return endpoints;
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
    headers: new Headers({ 'content-type': 'application/json', 'user-agent': 'LobeHub-Test' }),
    id: row.id,
    pathToken: secret,
    test: true,
  });
  return {
    accepted: result.status === 200 || result.status === 202,
    error: typeof result.body.error === 'string' ? result.body.error : undefined,
    status: result.status,
  };
}
