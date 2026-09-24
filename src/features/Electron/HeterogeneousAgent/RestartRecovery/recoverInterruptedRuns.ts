import { stripGoalCommand } from '@lobechat/builtin-tool-goal';
import { HETERO_RESTART_CONTINUE_PROMPT } from '@lobechat/const';
import type { ChatTopic, ConversationContext, UIChatMessage } from '@lobechat/types';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import {
  ensureEffectiveAgencyAccess,
  getEffectiveAgencyConfig,
  resolveHeteroRunContext,
  runHeterogeneousFromExistingMessage,
} from '@/features/Conversation/store/slices/generation/action';
import {
  getHeteroSessionIdForWorkingDirectory,
  setHeteroSessionBindingKeyForWorkingDirectory,
  setHeteroSessionIdForWorkingDirectory,
} from '@/helpers/heteroSessionByWorkingDirectory';
import { agentService } from '@/services/agent';
import { heterogeneousAgentService } from '@/services/electron/heterogeneousAgent';
import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { getNativeHeteroSessionBindingKey } from '@/store/chat/slices/agentRun/actions/transports/hetero/heteroResume';
import { getUserStoreState } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

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
  /** Assistant row the interrupted run streamed into — its branch root. */
  assistantMessageId?: string;
  /** Hosted provider binding the run's CLI session belongs to, when it had one. */
  bindingKey?: string;
  configDir?: string;
  cwd?: string;
  /** Too old to replay; hand the topic a status-only cleanup and stop there. */
  expired?: boolean;
  ipcSessionId: string;
  /** ISO timestamp of the spawn — the ownership token for the topic's latest turn. */
  startedAt?: string;
  topicId?: string;
}

/**
 * Topic states a restart can leave stranded. `running` is the ordinary one;
 * `waitingForHuman` is written when the CLI raised an AskUserQuestion, and a
 * restart kills both the CLI and its intervention bridge — nothing else ever
 * resets it, because the stale-topic watchdog only looks at `running`.
 */
const isInterruptedTopicStatus = (status: string | null | undefined): boolean =>
  status === 'running' || status === 'waitingForHuman';

const toTime = (value: UIChatMessage['createdAt']): number => {
  const time = typeof value === 'number' ? value : new Date(value as any).getTime();
  return Number.isFinite(time) ? time : 0;
};

/**
 * The run's own branch: its assistant row plus everything hanging off it. A
 * regenerated turn keeps several assistant branches under one user row, and
 * only this one belongs to the interrupted run.
 *
 * Stops at user rows: a later turn hangs its user row off this run's tail, so
 * walking past it would claim the follow-up conversation as the run's own —
 * and the replay would delete it. A run never writes user rows of its own
 * (queued messages are sent as a new turn once it ends), so every user row
 * below the root is a later turn. This happens with the Claude Code SDK, whose
 * turn can stay open waiting on background tasks while the user sends the next
 * one, leaving the earlier run on the ledger (LOBE-14379).
 */
const collectBranch = (messages: UIChatMessage[], rootId: string): string[] => {
  const childrenByParent = new Map<string, UIChatMessage[]>();
  for (const message of messages) {
    if (!message.parentId) continue;
    const siblings = childrenByParent.get(message.parentId) ?? [];
    siblings.push(message);
    childrenByParent.set(message.parentId, siblings);
  }

  const ids: string[] = [];
  const queue = [rootId];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    for (const child of childrenByParent.get(id) ?? []) {
      if (child.role !== 'user') queue.push(child.id);
    }
  }
  return ids;
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

  // `active` counts too, but only with a recorded assistant row to verify
  // ownership against: the stale-run watchdog flips an unclaimed topic there
  // after two hours, and its sweep means nobody picked the run up — not that it
  // finished. Every other status is somebody's decision (archived, failed,
  // scheduled, read) and is left alone.
  const claimable =
    isInterruptedTopicStatus(topic.status) ||
    (topic.status === 'active' && !!run.assistantMessageId);
  if (!claimable) return { outcome: 'skipped', reason: 'not-running', topicId };

  const chatStore = useChatStore.getState();
  const settle = () => chatStore.updateTopicStatus({ agentId, status: 'active', topicId });
  const context: ConversationContext = { agentId, topicId };

  // Ownership comes before ANY write or settling exit. Another device may be
  // running this topic right now, and settling it — or patching its metadata —
  // would clobber a live run even though no rows get deleted.
  const allMessages = await messageService.getMessages(context);
  const mainChain = mainChainOf(allMessages);

  // The run's own assistant row, when it lived long enough to persist one.
  // Ownership is then decided between rows that all carry the SAME clock (the
  // database's): comparing a server timestamp against the local spawn time
  // would read this topic's own user turn as a takeover on a desktop whose
  // clock runs behind the server.
  const ownRoot = run.assistantMessageId
    ? mainChain.find((message) => message.id === run.assistantMessageId)
    : undefined;
  const ownBranch = ownRoot ? new Set(collectBranch(mainChain, ownRoot.id)) : undefined;

  // Prefer the user row our own branch hangs off; only a run that never got a
  // row of its own has to guess at the topic's last turn.
  const ownUserTurn = ownRoot
    ? mainChain.find((message) => message.id === ownRoot.parentId && message.role === 'user')
    : undefined;
  const userTurn = ownUserTurn ?? mainChain.findLast((message) => message.role === 'user');

  if (ownBranch) {
    // Rows are ordered by one clock, so the newest row on the main chain says
    // it all: anything outside our branch means the topic moved on without us.
    const newest = mainChain.at(-1);
    if (newest && !ownBranch.has(newest.id)) {
      return { outcome: 'skipped', reason: 'topic-taken-over', topicId };
    }
    // The newest row alone is not enough: a run still open after the user sent
    // the next turn (Claude Code SDK waiting on a background task) can write a
    // late row into its own branch AFTER that turn finished. A user turn
    // chained onto our branch means the conversation continued past this run —
    // replaying would delete rows that turn is parented to (LOBE-14379).
    const hasFollowUpTurn = mainChain.some(
      (message) => message.role === 'user' && !!message.parentId && ownBranch.has(message.parentId),
    );
    if (hasFollowUpTurn) return { outcome: 'skipped', reason: 'topic-taken-over', topicId };
  } else {
    // Nothing of ours on the topic to anchor against. The spawn time is all
    // that is left — a cross-clock comparison, so it is only trusted to spot a
    // user turn that clearly postdates the run.
    const startedAt = run.startedAt ? Date.parse(run.startedAt) : Number.NaN;
    if (userTurn && Number.isFinite(startedAt) && toTime(userTurn.createdAt) > startedAt) {
      return { outcome: 'skipped', reason: 'topic-taken-over', topicId };
    }
  }

  // A regeneration hangs a NEW assistant branch off the SAME user row. When the
  // row we recorded is gone but another branch stands in its place, that branch
  // is somebody else's answer.
  const branchRoots = userTurn
    ? mainChain
        .filter((message) => message.parentId === userTurn.id && message.role !== 'user')
        .sort((a, b) => toTime(a.createdAt) - toTime(b.createdAt))
    : [];
  const newestRoot = branchRoots.at(-1);
  if (run.assistantMessageId && !ownRoot && newestRoot) {
    return { outcome: 'skipped', reason: 'topic-taken-over', topicId };
  }

  // Past the replay window. The transcript is too stale to reproduce, but the
  // topic is still parked mid-run with nobody left to release it — and the
  // stale-run watchdog only ever looks at `running`.
  if (run.expired) {
    await settle();
    return { outcome: 'skipped', reason: 'expired', topicId };
  }

  if (run.agentType !== 'claude-code') {
    await settle();
    return { outcome: 'skipped', reason: 'unsupported-run', topicId };
  }

  // Every failure from here on has to put the topic down: returning a result
  // releases the ledger entry, so nothing will retry this run and the topic
  // would otherwise spin until the two-hour stale watchdog notices.
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
      // The binding key travels WITH the session id: a provider-bound resume
      // whose key does not match the binding main resolves is dropped there,
      // and the replay then has no session to read. Both were written by the
      // same lost update, so both are restored.
      const bindingKey = run.bindingKey ?? getNativeHeteroSessionBindingKey(run.agentType);
      const patch = {
        heteroSessionBindingKey: bindingKey,
        heteroSessionBindingKeyByWorkingDirectory: setHeteroSessionBindingKeyForWorkingDirectory(
          topic.metadata,
          ledgerCwd,
          bindingKey,
        ),
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

    if (!userTurn) {
      await settle();
      return { outcome: 'skipped', reason: 'no-user-turn', topicId };
    }

    // Nothing is touched until the transcript is known to be readable: the
    // rows already persisted are the only record of the run when it is not.
    const probe = await heterogeneousAgentService.probeTranscriptReplay({
      agentType: run.agentType,
      configDir: run.configDir,
      cwd: workingDirectory,
      // A resumed session shares one transcript, so the last turn on disk may
      // still be the PREVIOUS one when the restart beat the CLI to recording
      // this prompt. Replaying that would rewrite the conversation.
      //
      // Stripped exactly like the executor strips it before sending: a `/goal`
      // turn reaches the CLI without its command word, so the raw row content
      // is not what the transcript recorded.
      expectedPrompt: stripGoalCommand(userTurn.content),
      // The CLI cannot have recorded this run's prompt before the run existed,
      // which is what tells two adjacent prompts apart when their text does not.
      notBefore: run.startedAt,
      sessionId: resumeSessionId,
    });
    if (!probe.available) {
      await settle();
      return { outcome: 'skipped', reason: `no-transcript: ${probe.reason ?? 'unknown'}`, topicId };
    }

    // Everything the interrupted turn persisted is a partial view of what the
    // transcript holds in full — replace it rather than try to stitch. Scoped
    // to the run's own branch: earlier completed answers under the same user
    // row are somebody's history, not this run's leftovers.
    const branchRootId = ownRoot?.id ?? newestRoot?.id;
    const staleIds = branchRootId ? collectBranch(mainChain, branchRootId) : [];
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
      // The transcript sits under the profile the interrupted run used, which
      // this turn's own account routing may no longer resolve to.
      replayTranscriptConfigDir: run.configDir,
      replayTranscriptStartedAt: run.startedAt,
      topic: topic as ChatTopic,
    });

    if (replayComplete === true) {
      chatStore.completeOperation(operationId);
      return { outcome: 'replayed', topicId };
    }

    // No outcome at all means the replay never ran: the executor swallowed the
    // failure and persisted a terminal error. Resuming here would spend a real
    // turn — and touch the workspace — on top of a replay that did not happen.
    if (replayComplete !== false) {
      throw new Error('Transcript replay reported no outcome');
    }

    // Chain the continuation onto the replayed tail so it grows the same
    // assistant group instead of opening a new bubble.
    const tail = mainChainOf(await messageService.getMessages(context)).findLast(
      (message) => message.role === 'assistant',
    );
    const continuation = await runHeterogeneousFromExistingMessage(chatStore, {
      context,
      heterogeneousProvider,
      parentMessageId: tail?.id ?? userTurn.id,
      parentOperationId: operationId,
      prompt: HETERO_RESTART_CONTINUE_PROMPT,
      topic: topic as ChatTopic,
    });
    // The executor persists a terminal error rather than throwing, so the call
    // resolving is not success. Reporting `resumed` here would tell the user a
    // run was picked up when the CLI never started.
    if (continuation.terminalError) {
      throw new Error('Restart continuation ended on a terminal error');
    }
    chatStore.completeOperation(operationId);
    return { outcome: 'resumed', topicId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (operationId) {
      chatStore.failOperation(operationId, { message, type: 'RestartRecoveryError' });
    }
    // The executor writes its own terminal status once it owns the run, so
    // only a topic still stuck in flight is put down here.
    const current = await topicService.getTopicDetail(topicId).catch(() => null);
    if (isInterruptedTopicStatus(current?.status)) await settle().catch(() => {});
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
  // Scoped to the user AND workspace this renderer is in: topic reads go
  // through both, so a run recorded elsewhere stays on the ledger until the
  // launch that owns it. Personal space has no workspace, which is why the
  // account has to be part of the key.
  const runs = (await heterogeneousAgentService.listInterruptedRuns({
    userId: userProfileSelectors.userId(getUserStoreState()),
    workspaceId: getActiveWorkspaceId() ?? undefined,
  })) as InterruptedRun[];
  if (!runs?.length) return [];

  // One recovery per topic; a later entry supersedes an earlier one.
  const byTopic = new Map<string, InterruptedRun>();
  const unkeyed: InterruptedRun[] = [];
  for (const run of runs) {
    if (!run.topicId) {
      unkeyed.push(run);
      continue;
    }
    const superseded = byTopic.get(run.topicId);
    byTopic.set(run.topicId, run);
    // The newer entry recovers this topic, so the one it replaces is spent —
    // left claimed, it would be retried at every launch until it runs out.
    if (superseded) {
      await heterogeneousAgentService
        .releaseInterruptedRun(superseded.ipcSessionId)
        .catch(() => {});
    }
  }

  const results: RestartRecoveryResult[] = [];
  for (const run of [...byTopic.values(), ...unkeyed]) {
    try {
      results.push(await recoverRun(run));
      // Recovery reached an outcome, so the ledger entry has done its job.
      // It is only released here: main hands entries over as CLAIMS, which is
      // what lets a crash in the middle of all this be retried at next launch.
      await heterogeneousAgentService.releaseInterruptedRun(run.ipcSessionId).catch(() => {});
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
