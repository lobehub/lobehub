import { TRACING_SCENARIOS } from '@lobechat/const';
import type { DecisionResponse } from '@lobechat/model-runtime';
import { buildChannelRoutingDecision, CHANNEL_ROUTING_PROMPT_VERSION } from '@lobechat/prompts';
import type { ChannelJobWake } from '@lobechat/types';
import { withTimeout } from 'es-toolkit';
import pMap from 'p-map';

import type { ChannelRoutingDecision } from '@/database/repositories/channel';
import {
  CHANNEL_ROUTING_LEASE_MS,
  ChannelExecutionRepository,
  ChannelRoutingRepository,
} from '@/database/repositories/channel';
import type { LobeChatDatabase } from '@/database/type';
import { resolveProviderRelay } from '@/server/modules/AgentRuntime/llmRelay/resolveLlmExecutionSite';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { createWakeClassify } from '@/server/services/conversationWake/classify';
import { createWakeDutyJudge } from '@/server/services/conversationWake/dutyJudge';
import { redisService } from '@/server/services/redis';

import { notifyChannel } from './notify';
import { wakeChannel } from './queue';
import { resolveChannelRoutingConfig } from './routingConfig';
import type { ChannelRoutingInput as RoutingInput, MemberWakeJudgement } from './wake';
import { judgeMemberWake, toChannelJobWake } from './wake';
import type { ChannelRoutingTrace } from './wakeRecords';
import { recordChannelWakeDecisions } from './wakeRecords';

export const CHANNEL_ROUTING_TIMEOUT_MS = 10_000;

/** Model calls the members' own rules may make per channel and UTC hour (classifier + duties). */
export const CHANNEL_WAKE_MODEL_CALLS_PER_HOUR = 300;

/** Why routing woke a member it was unsure about: it may stay silent. */
const UNCERTAIN_WAKE: ChannelJobWake = { kind: 'followup', reason: 'routing-uncertain' };

/**
 * Thresholds the decision model's answers. Only calibrated boolean probabilities count, never
 * choice concentration/confidence.
 *
 * - At least 0.7: chosen, and owes an answer.
 * - Between 0.3 and 0.7: woken as a `followup`, free to stay silent, unless its silent-wake
 *   budget is spent (`quiet`). Uncertainty is not a provider failure.
 * - At most 0.3: left out. Every answer confidently negative: `skipped`.
 * - Any answer missing or invalid: `unassigned`, whatever the others said.
 */
export const selectChannelResponders = (
  candidates: Pick<RoutingInput['candidates'][number], 'memberId'>[],
  response: DecisionResponse,
  quiet: ReadonlySet<string> = new Set(),
): ChannelRoutingDecision => {
  const selected: string[] = [];
  const uncertain: string[] = [];
  for (const { memberId } of candidates) {
    const answer = response.answers[memberId];
    if (
      !answer ||
      answer.type !== 'boolean' ||
      !Number.isFinite(answer.probability) ||
      answer.probability < 0 ||
      answer.probability > 1
    )
      return {
        reason: 'The decision model did not return valid probabilities for every candidate',
        status: 'unassigned',
      };
    if (answer.probability >= 0.7) selected.push(memberId);
    else if (answer.probability > 0.3 && !quiet.has(memberId)) uncertain.push(memberId);
  }
  if (!selected.length && !uncertain.length)
    return { reason: 'No Agent response is needed', status: 'skipped' };

  return {
    memberIds: [...selected, ...uncertain],
    reason: uncertain.length
      ? 'Selected by the Channel decision model; uncertain members may stay silent'
      : 'Selected by the Channel decision model',
    status: 'assigned',
    ...(uncertain.length && {
      wakes: Object.fromEntries(uncertain.map((memberId) => [memberId, UNCERTAIN_WAKE])),
    }),
  };
};

/** Compact per-member record of what the members' own rules said, for the routing audit row. */
const summarizeJudgements = (judgements: MemberWakeJudgement[]) =>
  JSON.stringify(
    Object.fromEntries(
      judgements.map((judgement) => [
        judgement.memberId,
        {
          ...(judgement.excluded && { excluded: true }),
          ...(judgement.quiet && { quiet: true }),
          ...(judgement.initiation && { wake: judgement.initiation.reason }),
          verdicts: (judgement.verdicts ?? []).map(
            ({ policyId, reason, verdict }) => `${policyId}:${verdict}:${reason}`,
          ),
        },
      ]),
    ),
  );

const utcHour = (at: number) => new Date(at).toISOString().slice(0, 13);

export class ChannelRoutingService {
  private readonly routing: ChannelRoutingRepository;
  private readonly executions: ChannelExecutionRepository;

  constructor(private readonly db: LobeChatDatabase) {
    this.routing = new ChannelRoutingRepository(db);
    this.executions = new ChannelExecutionRepository(db);
  }

  advance = async (channelId: string) => {
    const pending = await this.routing.pending(channelId);
    if (!pending.length) return;
    // Persist the recovery wakeup before taking a lease or making a billable call.
    await wakeChannel(channelId, CHANNEL_ROUTING_LEASE_MS);
    let resolved = 0;
    await pMap(
      pending,
      async ({ id }) => {
        const input = await this.routing.claim(channelId, id);
        if (!input) return;
        const trace: ChannelRoutingTrace = {};
        const decision = await this.decide(channelId, input, trace);
        const applied = await this.executions.resolveRouting(
          channelId,
          id,
          input.attempt,
          decision,
        );
        if (applied) {
          resolved += 1;
          // The resolver rechecks membership: record who was delivered to, not who was proposed,
          // so the wake history never reports a wake that no Agent received.
          await recordChannelWakeDecisions(this.db, channelId, input, decision, trace, applied);
        }
      },
      { concurrency: 3 },
    );
    await notifyChannel(this.db, channelId);
    // A resolved root may unlock replies skipped by this batch. Revisit immediately,
    // but do not hot-loop when every pending attempt belongs to another worker.
    if (resolved) await wakeChannel(channelId);
  };

  private async decide(
    channelId: string,
    input: RoutingInput,
    trace: ChannelRoutingTrace = {},
  ): Promise<ChannelRoutingDecision> {
    if (!input.candidates.length) return { reason: 'No Agent can answer here', status: 'skipped' };
    if (input.fallback)
      return {
        memberIds: input.candidates.map(({ memberId }) => memberId),
        reason: 'No decision model configured',
        status: 'assigned',
      };
    // Never silently drop candidates or truncate the actual request before classifying it.
    if (input.candidates.length > 20 || input.message.length > 12_000 || !input.message.trim())
      return { reason: 'Use an explicit mention for this message', status: 'unassigned' };

    const controller = new AbortController();
    const start = Date.now();
    const details = {
      promptVersion: CHANNEL_ROUTING_PROMPT_VERSION,
      scenario: TRACING_SCENARIOS.ChannelRouting,
    };
    // Bottom-up first: every member's own rules, the same pipeline an IM bot runs. Each model call
    // in them has its own short deadline, so this settles before the decision model's one starts.
    const judgements = await this.judgeMembers(channelId, input);
    trace.judgements = judgements;
    try {
      return await withTimeout(async () => {
        const wakes = (members: MemberWakeJudgement[]) =>
          Object.fromEntries(
            members.map(({ initiation, memberId }) => [memberId, toChannelJobWake(initiation!)]),
          );
        const claimed = judgements.filter(({ initiation }) => initiation);
        // Called by name: those members, and nobody needs to arbitrate.
        const named = claimed.filter(({ initiation }) => initiation!.reason === 'named-in-text');
        if (named.length)
          return {
            memberIds: named.map(({ memberId }) => memberId),
            reason: 'Named in the message',
            status: 'assigned' as const,
            wakes: wakes(named),
          };
        if (claimed.length === 1)
          return {
            memberIds: [claimed[0].memberId],
            reason: 'Woken by its own rules',
            status: 'assigned' as const,
            wakes: wakes(claimed),
          };

        // Top-down where the members' rules leave a choice: several claim the message, or none
        // does and the decision model picks among those whose rules allow it.
        const pool = claimed.length ? claimed : judgements.filter(({ excluded }) => !excluded);
        if (!pool.length)
          return { reason: 'Every Agent here waits to be addressed', status: 'skipped' as const };
        const candidates = input.candidates.filter(({ memberId }) =>
          pool.some((judgement) => judgement.memberId === memberId),
        );

        const config = await resolveChannelRoutingConfig(this.db, input.userId);
        if (!config) {
          return claimed.length
            ? {
                memberIds: claimed.map(({ memberId }) => memberId),
                reason: 'Woken by their own rules',
                status: 'assigned' as const,
                wakes: wakes(claimed),
              }
            : { reason: 'Channel decision model is disabled', status: 'unassigned' as const };
        }
        // A background worker has no initiating device tab. Never bypass the relay policy.
        if (
          await resolveProviderRelay({
            db: this.db,
            provider: config.provider,
            userId: input.userId,
            workspaceId: input.workspaceId ?? undefined,
          })
        )
          throw new Error('Channel routing requires a server-accessible provider');
        controller.signal.throwIfAborted();
        const runtime = await initModelRuntimeFromDB(
          this.db,
          input.userId,
          config.provider,
          input.workspaceId ?? undefined,
        );
        controller.signal.throwIfAborted();
        const response = await runtime.decide(
          {
            ...buildChannelRoutingDecision({ ...input, candidates }),
            model: config.model,
          },
          {
            metadata: {
              ...details,
              channelId,
              messageId: input.messageId,
              routingAttempt: input.attempt,
              trigger: 'channel',
            },
            signal: controller.signal,
            user: input.userId,
          },
        );
        trace.answers = response.answers;
        const quiet = new Set(
          judgements.filter((judgement) => judgement.quiet).map(({ memberId }) => memberId),
        );
        const selected = selectChannelResponders(candidates, response, quiet);
        // Arbitrating claims keeps any claimer that is not a confident no, woken for the reason its
        // own rules gave: none of them owes an answer. An unusable answer is no verdict on the
        // claims, so they all stand.
        const kept =
          selected.status === 'assigned'
            ? claimed.filter(({ memberId }) => selected.memberIds.includes(memberId))
            : selected.status === 'unassigned'
              ? claimed
              : [];
        const decision: ChannelRoutingDecision = !claimed.length
          ? selected
          : kept.length
            ? {
                memberIds: kept.map(({ memberId }) => memberId),
                reason: 'Woken by their own rules; arbitrated by the Channel decision model',
                status: 'assigned',
                wakes: wakes(kept),
              }
            : selected;
        return {
          ...decision,
          details: {
            ...details,
            latencyMs: Date.now() - start,
            model: config.model,
            provider: config.provider,
            servedModel: response.model,
            probabilities: JSON.stringify(response.answers),
            wakeRules: summarizeJudgements(judgements),
            ...(response.usage?.totalTokens !== undefined && {
              totalTokens: response.usage.totalTokens,
            }),
          },
        };
      }, CHANNEL_ROUTING_TIMEOUT_MS);
    } catch (error) {
      // Do not persist provider error text: it may include user content or credentials.
      console.error('[channel:routing]', {
        channelId,
        messageId: input.messageId,
        error: error instanceof Error ? error.name : 'DecisionError',
      });
      const claimed = judgements.filter(({ initiation }) => initiation);
      // The members' own rules already decided: a failed arbitration must not drop them.
      if (claimed.length)
        return {
          details: { ...details, latencyMs: Date.now() - start },
          memberIds: claimed.map(({ memberId }) => memberId),
          reason: 'Woken by their own rules; the Channel decision model failed or timed out',
          status: 'assigned',
          wakes: Object.fromEntries(
            claimed.map(({ initiation, memberId }) => [memberId, toChannelJobWake(initiation!)]),
          ),
        };
      return {
        details: { ...details, latencyMs: Date.now() - start },
        reason: 'The Channel decision model failed or timed out',
        status: 'unassigned',
      };
    } finally {
      controller.abort();
    }
  }

  /**
   * Each candidate's own wake rules. Their model calls (classifier, duty judge) run as the
   * sender, like routing, and share one hourly budget per channel; a member whose rules fail is
   * left to routing.
   */
  private async judgeMembers(channelId: string, input: RoutingInput) {
    const options = {
      db: this.db,
      userId: input.userId,
      workspaceId: input.workspaceId ?? undefined,
    };
    const budgeted =
      <TInput, TOutput>(call: (input: TInput, abortSignal: AbortSignal) => Promise<TOutput>) =>
      async (value: TInput, abortSignal: AbortSignal): Promise<TOutput> => {
        const calls = await redisService.botWake.countClassifierCall(
          `channel:${channelId}`,
          utcHour(Date.now()),
        );
        if (calls === undefined || calls > CHANNEL_WAKE_MODEL_CALLS_PER_HOUR)
          throw new Error('classifier-budget');
        return call(value, abortSignal);
      };
    const deps = {
      classify: budgeted(createWakeClassify(options)),
      dutyJudge: budgeted(createWakeDutyJudge(options)),
      now: Date.now(),
    };

    return pMap(
      input.candidates,
      async (candidate) => {
        try {
          return await judgeMemberWake(channelId, input, candidate, deps);
        } catch (error) {
          console.error('[channel:wake]', {
            channelId,
            memberId: candidate.memberId,
            error: error instanceof Error ? error.name : 'WakeError',
          });
          return { excluded: false, memberId: candidate.memberId, quiet: false };
        }
      },
      // At most 20 candidates reach this point; in parallel, one slow member delays none.
      { concurrency: input.candidates.length || 1 },
    );
  }
}
