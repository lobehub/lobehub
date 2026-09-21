import { HETERO_RESTART_CONTINUE_PROMPT } from '@lobechat/const';
import type { ChatTopic, ConversationContext, UIChatMessage } from '@lobechat/types';

import {
  ensureEffectiveAgencyAccess,
  getEffectiveAgencyConfig,
  resolveHeteroRunContext,
  runHeterogeneousFromExistingMessage,
} from '@/features/Conversation/store/slices/generation/action';
import {
  getHeteroSessionIdForWorkingDirectory,
  setHeteroSessionIdForWorkingDirectory,
} from '@/helpers/heteroSessionByWorkingDirectory';
import { agentService } from '@/services/agent';
import { heterogeneousAgentService } from '@/services/electron/heterogeneousAgent';
import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';

/**
 * Pick local Claude Code runs back up after the desktop app restarted.
 *
 * What a restart leaves behind: the topic still `running`, whatever rows the
 * renderer flushed before it died, and — on disk — the CLI's own transcript
 * holding everything the run produced, possibly including a finished answer
 * the app never saw. Desktop main also keeps a ledger of the runs it spawned
 * (`listInterruptedRuns`), which is how a run killed HERE is told apart from
 * one still running on another device.
 *
 * Per run: drop the half-persisted assistant rows of the interrupted turn,
 * replay that turn from the transcript into a fresh row (same pipeline as a
 * live run, so tools / thinking / usage land as if the app had been watching),
 * then — only if the transcript shows the turn was cut off — `--resume` the
 * session with a continuation prompt so the agent finishes the job.
 */

export type RestartRecoveryOutcome = 'replayed' | 'resumed' | 'skipped' | 'failed';

export interface RestartRecoveryResult {
  outcome: RestartRecoveryOutcome;
  reason?: string;
  topicId?: string;
}

interface InterruptedRun {
  agentId?: string;
  /** CLI-native session id main saw on the stream — the ledger's own copy. */
  agentSessionId?: string;
  agentType: string;
  configDir?: string;
  cwd?: string;
  ipcSessionId: string;
  /** ISO timestamp of the spawn — the ownership token for the topic's latest turn. */
  startedAt?: string;
  topicId?: string;
}

const toTime = (value: UIChatMessage['createdAt']): number => {
  const time = typeof value === 'number' ? value : new Date(value as any).getTime();
  return Number.isFinite(time) ? time : 0;
};

/** Rows on the topic's main chain, oldest first. Subagent threads are left alone. */
const mainChainOf = (messages: UIChatMessage[]): UIChatMessage[] =>
  messages
    .filter((message) => !message.threadId)
    .sort((a, b) => toTime(a.createdAt) - toTime(b.createdAt));

/**
 * The agent store is filled by SWR hooks as screens mount; at boot the agent
 * of a background topic is usually not there yet, and the agency config
 * (which CLI, which auth) lives on it.
 */
const ensureAgentLoaded = async (agentId: string): Promise<void> => {
  if (useAgentStore.getState().agentMap[agentId]?.agencyConfig) return;
  const config = await agentService.getAgentConfigById(agentId);
  if (!config) throw new Error(`Agent ${agentId} not found`);
  useAgentStore.setState(
    (state) => ({ agentMap: { ...state.agentMap, [agentId]: config } }),
    false,
    'restartRecovery/ensureAgentLoaded',
  );
};

const recoverRun = async (run: InterruptedRun): Promise<RestartRecoveryResult> => {
  const { agentId, topicId } = run;
  if (!agentId || !topicId) return { outcome: 'skipped', reason: 'missing-context', topicId };

  const topic = await topicService.getTopicDetail(topicId);
  if (!topic) return { outcome: 'skipped', reason: 'topic-missing', topicId };
  // Settled elsewhere already (another device, the stale-run watchdog, the user).
  if (topic.status !== 'running') return { outcome: 'skipped', reason: 'not-running', topicId };

  const chatStore = useChatStore.getState();
  const settle = () => chatStore.updateTopicStatus({ agentId, status: 'active', topicId });

  if (run.agentType !== 'claude-code') {
    await settle();
    return { outcome: 'skipped', reason: 'unsupported-run', topicId };
  }

  // Every failure from here on has to put the topic down: `listInterruptedRuns`
  // already consumed the ledger entry, so nothing will retry this run and the
  // topic would otherwise spin until the two-hour stale watchdog notices.
  let operationId: string | undefined;
  try {
    await ensureAgentLoaded(agentId);
    await ensureEffectiveAgencyAccess(agentId);
    const heterogeneousProvider =
      getEffectiveAgencyConfig(agentId).agencyConfig?.heterogeneousProvider;
    if (heterogeneousProvider?.type !== 'claude-code') {
      await settle();
      return { outcome: 'skipped', reason: 'provider-mismatch', topicId };
    }

    const context: ConversationContext = { agentId, topicId };

    // The topic's resume metadata is written by the renderer as the stream
    // starts; a quit that lands between main patching the ledger and that write
    // settling leaves the topic without a session id even though the ledger
    // knows it. Restore the write from the ledger so the run stays resumable.
    const ledgerCwd = topic.metadata?.workingDirectory ?? run.cwd;
    if (
      run.agentSessionId &&
      ledgerCwd &&
      !getHeteroSessionIdForWorkingDirectory(topic.metadata, ledgerCwd)
    ) {
      const patch = {
        heteroSessionId: run.agentSessionId,
        heteroSessionIdByWorkingDirectory: setHeteroSessionIdForWorkingDirectory(
          topic.metadata,
          ledgerCwd,
          run.agentSessionId,
        ),
        workingDirectory: ledgerCwd,
      };
      await chatStore.updateTopicMetadata(topicId, patch);
      topic.metadata = { ...topic.metadata, ...patch };
    }

    // Ask the SAME resolver the run itself will use. Comparing adapter types is
    // not enough: an auth binding the user changed while the app was down makes
    // the saved session unresumable, and finding that out after the rows are
    // gone would lose the output for nothing.
    const { resumeSessionId, workingDirectory } = resolveHeteroRunContext(
      chatStore,
      context,
      agentId,
      topic as ChatTopic,
    );
    if (!resumeSessionId) {
      await settle();
      return { outcome: 'skipped', reason: 'resume-unavailable', topicId };
    }

    // Nothing is touched until the transcript is known to be readable: the
    // rows already persisted are the only record of the run when it is not.
    const probe = await heterogeneousAgentService.probeTranscriptReplay({
      agentType: run.agentType,
      configDir: run.configDir,
      cwd: workingDirectory,
      sessionId: resumeSessionId,
    });
    if (!probe.available) {
      await settle();
      return { outcome: 'skipped', reason: `no-transcript: ${probe.reason ?? 'unknown'}`, topicId };
    }

    const allMessages = await messageService.getMessages(context);
    const mainChain = mainChainOf(allMessages);
    const userTurn = mainChain.findLast((message) => message.role === 'user');
    if (!userTurn) {
      await settle();
      return { outcome: 'skipped', reason: 'no-user-turn', topicId };
    }

    // The topic is `running` — but is it running OUR run? Another device may
    // have started a newer turn on it while this desktop was down. Its user row
    // postdates our spawn, and recovering would delete that live run's output
    // and replay a stale session over it. Leave the topic completely alone:
    // settling it would also clobber the other device's status.
    const startedAt = run.startedAt ? Date.parse(run.startedAt) : Number.NaN;
    if (Number.isFinite(startedAt) && toTime(userTurn.createdAt) > startedAt) {
      return { outcome: 'skipped', reason: 'topic-taken-over', topicId };
    }

    // Everything the interrupted turn persisted is a partial view of what the
    // transcript holds in full — replace it rather than try to stitch.
    const userAt = toTime(userTurn.createdAt);
    const staleIds = mainChain
      .filter(
        (message) =>
          message.id !== userTurn.id &&
          message.role !== 'user' &&
          toTime(message.createdAt) >= userAt,
      )
      .map((message) => message.id);
    if (staleIds.length > 0) await messageService.removeMessages(staleIds, context);

    // Seed the in-memory list ourselves: while the recovery op is running, the
    // topic's own fetch is gated off (a mid-run snapshot would clobber streamed
    // rows), so without this the surviving user turn never reaches the view
    // and only the rows the executor dispatches would render.
    const staleIdSet = new Set(staleIds);
    chatStore.replaceMessages(
      allMessages.filter((message) => !staleIdSet.has(message.id)),
      { action: 'restartRecovery', context },
    );

    operationId = chatStore.startOperation({
      context: { ...context, messageId: userTurn.id },
      type: 'regenerate',
    }).operationId;

    const { replayComplete } = await runHeterogeneousFromExistingMessage(chatStore, {
      context,
      heterogeneousProvider,
      parentMessageId: userTurn.id,
      parentOperationId: operationId,
      prompt: userTurn.content,
      replayTranscript: true,
      topic: topic as ChatTopic,
    });

    if (replayComplete) {
      chatStore.completeOperation(operationId);
      return { outcome: 'replayed', topicId };
    }

    // Chain the continuation onto the replayed tail so it grows the same
    // assistant group instead of opening a new bubble.
    const tail = mainChainOf(await messageService.getMessages(context)).findLast(
      (message) => message.role === 'assistant',
    );
    await runHeterogeneousFromExistingMessage(chatStore, {
      context,
      heterogeneousProvider,
      parentMessageId: tail?.id ?? userTurn.id,
      parentOperationId: operationId,
      prompt: HETERO_RESTART_CONTINUE_PROMPT,
      topic: topic as ChatTopic,
    });
    chatStore.completeOperation(operationId);
    return { outcome: 'resumed', topicId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (operationId) {
      chatStore.failOperation(operationId, { message, type: 'RestartRecoveryError' });
    }
    // The executor writes its own terminal status once it owns the run, so
    // only a topic still marked running is put down here.
    const current = await topicService.getTopicDetail(topicId).catch(() => null);
    if (current?.status === 'running') await settle().catch(() => {});
    return { outcome: 'failed', reason: message, topicId };
  } finally {
    // Reconcile with the server snapshot now that nothing is streaming. Only
    // meaningful once a run actually started; the early exits above never
    // touched the in-memory list.
    if (operationId) {
      await chatStore.refreshMessages({ agentId, topicId }).catch(() => {});
    }
  }
};

/**
 * Recover every run the previous desktop process left in flight. Runs are
 * handled one after another: each replay + resume is a full CLI turn, and the
 * ledger rarely holds more than one or two.
 */
export const recoverInterruptedHeteroRuns = async (): Promise<RestartRecoveryResult[]> => {
  const runs = (await heterogeneousAgentService.listInterruptedRuns()) as InterruptedRun[];
  if (!runs?.length) return [];

  // One recovery per topic; a later entry supersedes an earlier one.
  const byTopic = new Map<string, InterruptedRun>();
  const unkeyed: InterruptedRun[] = [];
  for (const run of runs) {
    if (run.topicId) byTopic.set(run.topicId, run);
    else unkeyed.push(run);
  }

  const results: RestartRecoveryResult[] = [];
  for (const run of [...byTopic.values(), ...unkeyed]) {
    try {
      results.push(await recoverRun(run));
    } catch (error) {
      console.error('[restartRecovery] recovery failed:', run.topicId, error);
      results.push({
        outcome: 'failed',
        reason: error instanceof Error ? error.message : String(error),
        topicId: run.topicId,
      });
    }
  }
  return results;
};
