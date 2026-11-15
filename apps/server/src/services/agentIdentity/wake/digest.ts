import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';

import type { AgentAccountView } from '@/database/models/agentAccount';
import { AgentAccountModel } from '@/database/models/agentAccount';
import type { AgentInboxEntry } from '@/database/models/agentInbox';
import { AgentInboxModel } from '@/database/models/agentInbox';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { AiAgentService } from '@/server/services/aiAgent';
import { QueueService } from '@/server/services/queue';
import { agentSignalScopeFlowControl } from '@/server/workflows/agentSignal';

import {
  createOwnerChannelReportHook,
  INBOX_RUN_INTERVENTION,
  INBOX_RUN_PLUGIN_IDS,
  OWNER_CHANNEL_INSTRUCTION,
} from '../ownerChannel';
import { buildInboxTopicTitle, fenceUntrustedInbox, toUntrustedInboxEntry } from '../untrusted';
import type { ResolvedWakeConfig } from './config';
import { resolveWakeConfig } from './config';

const log = debug('lobe-server:agent-identity:mail-digest');

export const DIGEST_FLUSH_ENDPOINT = '/api/agent/accounts/digest-flush';

/** Most messages one digest run reads; the rest go to the next flush. */
export const DIGEST_BATCH_LIMIT = 30;

/** Body budget per message in the digest prompt; the full text stays readable through the tool. */
const DIGEST_BODY_PREVIEW_CHARS = 600;

/**
 * How far back a digest looks. A held message older than this missed every digest since (each
 * flush failed); running it now would only surprise the owner, so it stays in the inbox unread.
 */
const DIGEST_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

/** When the batch was full, the next flush comes this soon instead of a whole window later. */
const DIGEST_FOLLOW_UP_MS = 60 * 1000;

/** What the delayed flush carries back. */
export interface DigestFlushPayload {
  accountId: string;
  /** The window end this flush was booked for; part of its dedupe key. */
  at: number;
}

/**
 * The digest needs a delay queue that survives a restart (QStash). The local, in-process queue
 * would lose an unfired timer, so without a real queue there is no digest and a held message
 * would never run: callers wake at once instead.
 */
export const isDigestAvailable = (): boolean => !new QueueService().isLocalExecution();

/** End of the window `now` falls in. Every delivery in one window books the same flush. */
export const digestWindowEnd = (now: number, digestMs: number): number =>
  Math.ceil((now + 1) / digestMs) * digestMs;

/**
 * Books the flush that will run the digest. Idempotent per account and window: QStash drops a
 * second booking with the same deduplication id, so every held delivery can call it.
 */
export const scheduleDigestFlush = async (accountId: string, at: number): Promise<void> => {
  const queue = new QueueService();
  const baseURL = process.env.AGENT_RUNTIME_BASE_URL || appEnv.APP_URL || 'http://localhost:3010';
  const payload: DigestFlushPayload = { accountId, at };

  await queue.scheduleMessage({
    deduplicationId: `agent-mail-digest:${accountId}:${at}`,
    delay: Math.max(0, at - Date.now()),
    endpoint: new URL(DIGEST_FLUSH_ENDPOINT, baseURL).toString(),
    // One account's flushes run one at a time, so two of them never split a batch.
    flowControl: agentSignalScopeFlowControl(`agent-mail:${accountId}`),
    operationId: `agent-mail-digest:${accountId}`,
    payload,
    retries: 3,
    stepIndex: 0,
  });
};

/** Holds a delivery for the digest of the window it arrived in. */
export const holdForDigest = (
  account: Pick<AgentAccountView, 'id'>,
  config: Pick<ResolvedWakeConfig, 'digestMs'>,
  now = Date.now(),
): Promise<void> => scheduleDigestFlush(account.id, digestWindowEnd(now, config.digestMs));

/**
 * The prompt of a digest run. As with a single wake, only the instructions are ours; every message
 * rides inside the `<untrusted_inbox>` fence.
 */
export const buildDigestPrompt = (account: AgentAccountView, messages: AgentInboxEntry[]): string =>
  [
    `${messages.length} message${messages.length === 1 ? '' : 's'} arrived for your ${account.kind} account ${account.identifier} and were held for this digest, oldest first.`,
    'Go through them together: work out which ones need your owner, which ones you can take care of, and which are noise. Tell your owner only about what needs them, briefly, and say why.',
    OWNER_CHANNEL_INSTRUCTION,
    fenceUntrustedInbox(
      messages.map((message) =>
        toUntrustedInboxEntry(message, { maxBodyChars: DIGEST_BODY_PREVIEW_CHARS }),
      ),
    ),
  ].join('\n\n');

/** Starts the digest run. Injected so the flush can be exercised without the run pipeline. */
export type DigestRunStarter = (input: {
  account: AgentAccountView;
  messages: AgentInboxEntry[];
}) => Promise<{ error?: string; topicId?: string }>;

/** Production starter: one run in a fresh topic, stamped as an inbox event like a single wake. */
export const createDigestRunStarter =
  (db: LobeChatDatabase): DigestRunStarter =>
  async ({ account, messages }) => {
    const service = new AiAgentService(db, account.userId, {
      workspaceId: account.workspaceId ?? undefined,
    });
    const result = await service.execAgent({
      agentId: account.agentId,
      appContext: { scope: 'agent' },
      exclusivePluginIds: INBOX_RUN_PLUGIN_IDS,
      hooks: [createOwnerChannelReportHook(db, account.id)],
      prompt: buildDigestPrompt(account, messages),
      title: buildInboxTopicTitle(messages),
      trigger: RequestTrigger.Inbox,
      userInterventionConfig: INBOX_RUN_INTERVENTION,
    });

    return { error: result.error, topicId: result.topicId };
  };

export type DigestFlushResult =
  | 'empty'
  | 'no-account'
  | 'started'
  /** The owner switched the account's wake off after the messages were held. */
  | 'wake-off';

/**
 * QStash delivered a flush: takes what the account is holding and starts one run for it.
 *
 * A flush may arrive more than once; the claim on each item makes a second one find nothing. A run
 * that fails to start gives its items back, books the next window's flush and throws, so QStash
 * retries this one and, should every retry fail, the next window tries again instead of the
 * messages waiting for an unrelated delivery. A full batch whose follow-up booking fails throws
 * too: the batch itself is done, and the retry finishes the leftover mail.
 */
export const runDigestFlush = async (
  db: LobeChatDatabase,
  payload: DigestFlushPayload,
  startRun: DigestRunStarter = createDigestRunStarter(db),
): Promise<DigestFlushResult> => {
  const account = await AgentAccountModel.findByIdUnscoped(db, payload.accountId);
  if (!account || account.status === 'revoked' || account.status === 'suspended') {
    return 'no-account';
  }
  const config = resolveWakeConfig(account.settings);
  if (config.mode === 'off') return 'wake-off';

  const ids = await AgentInboxModel.claimDigest(db, {
    accountId: account.id,
    limit: DIGEST_BATCH_LIMIT,
    since: new Date(Date.now() - DIGEST_LOOKBACK_MS),
  });
  if (ids.length === 0) return 'empty';

  const giveBack = async (error: unknown): Promise<never> => {
    console.error(
      '[mailDigest] the run for %d held message(s) of account %s did not start:',
      ids.length,
      account.id,
      error,
    );
    await AgentInboxModel.releaseWakes(db, ids).catch(() => undefined);
    // The window after this flush's own, even when QStash delivered it early.
    await holdForDigest(account, config, Math.max(Date.now(), payload.at)).catch((bookError) =>
      console.error('[mailDigest] booking the next flush for %s failed:', account.id, bookError),
    );
    throw error instanceof Error ? error : new Error(String(error));
  };

  let result: Awaited<ReturnType<DigestRunStarter>>;
  try {
    const messages = await AgentInboxModel.findEntries(db, ids);
    result = await startRun({ account, messages });
  } catch (error) {
    return giveBack(error);
  }
  if (result.error) return giveBack(new Error(`digest run did not start: ${result.error}`));

  // The run has its messages. Failing to stamp them must not fail the flush, or QStash's retry
  // would start a second run at once. The claims keep them out of digests for the claim lease;
  // past it a later digest would take them again, so the failure is logged loudly.
  try {
    await AgentInboxModel.markManyWoken(db, ids, result.topicId);
  } catch (error) {
    console.error(
      '[mailDigest] run started but marking messages %s read failed:',
      ids.join(','),
      error,
    );
  }

  // A full batch means mail is still waiting, and only this booking would come for it: nobody
  // writes to the account again just to book one. Fail the flush rather than acknowledge it, so
  // QStash retries — the batch above is already stamped, so the retry takes the leftover mail,
  // runs it and books its own follow-up instead of leaving it unread.
  if (ids.length === DIGEST_BATCH_LIMIT) {
    try {
      await scheduleDigestFlush(account.id, Date.now() + DIGEST_FOLLOW_UP_MS);
    } catch (error) {
      console.error('[mailDigest] booking the follow-up flush for %s failed:', account.id, error);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  log('started a digest run for %d message(s) of account %s', ids.length, account.id);
  return 'started';
};
