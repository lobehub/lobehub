import { TRACING_SCENARIOS } from '@lobechat/const';
import type { DecisionResponse } from '@lobechat/model-runtime';
import { buildChannelRoutingDecision, CHANNEL_ROUTING_PROMPT_VERSION } from '@lobechat/prompts';
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

import { notifyChannel } from './notify';
import { wakeChannel } from './queue';
import { resolveChannelRoutingConfig } from './routingConfig';

export const CHANNEL_ROUTING_TIMEOUT_MS = 10_000;
type RoutingInput = Extract<
  Awaited<ReturnType<ChannelRoutingRepository['claim']>>,
  { status: 'claimed' }
>;

/** Only calibrated boolean probabilities are thresholded, never choice concentration/confidence. */
export const selectChannelResponders = (
  candidates: RoutingInput['candidates'],
  response: DecisionResponse,
): ChannelRoutingDecision => {
  const selected: string[] = [];
  let hasUncertainAnswer = false;
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
    else if (answer.probability > 0.3) hasUncertainAnswer = true;
  }
  // Validate every answer before broadcasting: uncertainty is not a provider failure.
  if (hasUncertainAnswer)
    return {
      memberIds: candidates.map(({ memberId }) => memberId),
      reason: 'Decision uncertain; selected all eligible Agents',
      status: 'assigned',
    };
  return selected.length
    ? { memberIds: selected, reason: 'Selected by the Channel decision model', status: 'assigned' }
    : { reason: 'No Agent response is needed', status: 'skipped' };
};

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
    await pMap(
      pending,
      async ({ id }) => {
        const input = await this.routing.claim(channelId, id);
        if (!input) return;
        if (input.status === 'settled') {
          await wakeChannel(channelId);
          return;
        }
        const decision = await this.decide(channelId, input);
        // Every committed decision can unblock jobs or deferred Thread replies, even
        // without recipients. Wake them without waiting for this batch's slower decisions.
        if (await this.executions.resolveRouting(channelId, id, input.attempt, decision))
          await wakeChannel(channelId);
      },
      { concurrency: 3, stopOnError: false },
    );
    await notifyChannel(this.db, channelId);
  };

  private async decide(channelId: string, input: RoutingInput): Promise<ChannelRoutingDecision> {
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
    try {
      return await withTimeout(async () => {
        const config = await resolveChannelRoutingConfig(this.db, input.userId);
        if (!config) return { reason: 'Channel decision model is disabled', status: 'unassigned' };
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
            ...buildChannelRoutingDecision(input),
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
        return {
          ...selectChannelResponders(input.candidates, response),
          details: {
            ...details,
            latencyMs: Date.now() - start,
            model: config.model,
            provider: config.provider,
            servedModel: response.model,
            probabilities: JSON.stringify(response.answers),
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
      return {
        details: { ...details, latencyMs: Date.now() - start },
        reason: 'The Channel decision model failed or timed out',
        status: 'unassigned',
      };
    } finally {
      controller.abort();
    }
  }
}
