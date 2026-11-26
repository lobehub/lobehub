import type { LobeChatDatabase } from '@lobechat/database';
import type { ChannelReplyErrorInput, ChannelReplyErrorPromptAction } from '@lobechat/prompts';
import debug from 'debug';
import { eq } from 'drizzle-orm';

import type { ChannelReplyErrorFacts } from '@/database/repositories/channel';
import { ChannelExecutionRepository } from '@/database/repositories/channel';
import { userSettings } from '@/database/schemas';

import { notifyChannel } from '../notify';
import { describeLastStep } from './lastStep';
import { isChineseLocale, ruleBasedReplyError } from './rules';
import type { ChannelReplyErrorSummarizer } from './summarizer';
import {
  CHANNEL_REPLY_ERROR_SUMMARY_TIMEOUT_MS,
  createChannelReplyErrorSummarizer,
} from './summarizer';

const log = debug('lobe-server:channel:reply-error');

export interface ReportChannelReplyFailureDeps {
  /** Builds the model refinement; `false` keeps the rule-based card. */
  createSummarizer?: ((facts: ChannelReplyErrorFacts) => ChannelReplyErrorSummarizer) | false;
  /** Skips the gateway invalidation, for storage tests. */
  notify?: (db: LobeChatDatabase, channelId: string) => Promise<void>;
  timeoutMs?: number;
}

const CJK = /[㐀-鿿]/;

/**
 * The requester's language: their response-language setting, else the language of the request
 * itself (Chinese when it has Han characters), so the card reads like the conversation.
 */
const resolveLocale = async (db: LobeChatDatabase, facts: ChannelReplyErrorFacts) => {
  if (facts.requesterUserId) {
    const [row] = await db
      .select({ general: userSettings.general })
      .from(userSettings)
      .where(eq(userSettings.id, facts.requesterUserId))
      .limit(1);
    const language = (row?.general as { responseLanguage?: unknown } | null)?.responseLanguage;
    if (typeof language === 'string' && /^[a-z]{2}/i.test(language)) return language;
  }
  return CJK.test(facts.request) ? 'zh-CN' : 'en-US';
};

/**
 * Someone stopped the run from its conversation rather than the Channel (which cancels the job
 * and never gets here): their stop is not a failure to explain.
 */
const stoppedByPerson = (facts: ChannelReplyErrorFacts) =>
  facts.operation?.status === 'interrupted' &&
  /user/i.test(facts.operation.interruption?.reason ?? '');

const refine = async (
  db: LobeChatDatabase,
  channelId: string,
  facts: ChannelReplyErrorFacts,
  input: Omit<ChannelReplyErrorInput, 'lastStep'>,
  summarizer: ChannelReplyErrorSummarizer,
  timeoutMs: number,
  notify: (db: LobeChatDatabase, channelId: string) => Promise<void>,
): Promise<boolean> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const lastStep = await describeLastStep(db, facts);
    const refined = await Promise.race([
      summarizer({ ...input, lastStep }, controller.signal),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('timeout')));
      }),
    ]);
    // Only steps the server can carry out for this failure, in the model's order.
    const allowed: readonly string[] = input.allowedActions;
    const actions = refined?.actions.filter((action) => allowed.includes(action));
    if (!refined?.summary.trim() || !actions?.length) return false;
    const changed = await new ChannelExecutionRepository(db).refineReplyError(
      channelId,
      facts.job.id,
      facts.job.operationId,
      { actions: [...new Set(actions)], summary: refined.summary.trim() },
    );
    if (changed) await notify(db, channelId);
    return changed;
  } catch (error) {
    log('summary for job %s kept the rule-based card: %O', facts.job.id, error);
    return false;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Explains a reply that ended for a system reason in the Agent's reply slot (see
 * `upsertReplyError`): first a rule-based card per failure kind, posted right away so a card
 * always exists, then, unless the run was a shared Agent's (whose failure text its visitor may
 * not see), a sentence and action order from the deployment's mini model that replace it in place.
 *
 * A job that did not fail (completed, silent, stopped through the Channel), a stop made from the
 * run's own conversation and a run already reported change nothing. Never throws.
 *
 * Returns the refinement still in flight, for callers (tests) that wait for it; production
 * callers leave it running.
 */
export const reportChannelReplyFailure = async (
  db: LobeChatDatabase,
  channelId: string,
  jobId: string,
  deps: ReportChannelReplyFailureDeps = {},
): Promise<{ messageId: string; refinement?: Promise<boolean> } | undefined> => {
  const notify = deps.notify ?? notifyChannel;
  try {
    const executions = new ChannelExecutionRepository(db);
    const facts = await executions.replyErrorFacts(channelId, jobId);
    if (!facts || stoppedByPerson(facts)) return;

    const locale = await resolveLocale(db, facts);
    const { kind, ...draft } = ruleBasedReplyError(facts, locale);
    const posted = await executions.postReplyError(channelId, jobId, draft);
    if (!posted?.changed) return posted && { messageId: posted.messageId };
    log(
      'job %s failed (%s), card %s attempt %d',
      jobId,
      kind,
      posted.messageId,
      posted.card.attempts,
    );
    await notify(db, channelId);

    // An access card's sentence and its one action are the point; a model adds nothing to them.
    if (
      facts.share ||
      kind === 'access_denied' ||
      kind === 'access_required' ||
      deps.createSummarizer === false ||
      !facts.operation
    )
      return posted;
    const summarizer =
      deps.createSummarizer?.(facts) ??
      createChannelReplyErrorSummarizer({
        agentId: facts.agent.id,
        channelId,
        db,
        userId: facts.operation.userId,
        workspaceId: facts.operation.workspaceId ?? undefined,
      });
    const refinement = refine(
      db,
      channelId,
      facts,
      {
        agentName: facts.agent.name || 'Agent',
        allowedActions: draft.actions.filter(
          (action): action is ChannelReplyErrorPromptAction => action !== 'request_access',
        ),
        deviceOffline: kind === 'device',
        errorMessage: draft.errorMessage,
        errorType: draft.errorType,
        locale: isChineseLocale(locale) ? 'zh-CN' : locale,
      },
      summarizer,
      deps.timeoutMs ?? CHANNEL_REPLY_ERROR_SUMMARY_TIMEOUT_MS,
      notify,
    );
    return { messageId: posted.messageId, refinement };
  } catch (error) {
    console.error('[channel:replyError]', error);
  }
};
