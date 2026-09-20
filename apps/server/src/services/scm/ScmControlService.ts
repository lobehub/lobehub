import type { GithubIntegrationPreference } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';
import { eq } from 'drizzle-orm';

import { ScmChangeRequestModel, ScmInstallationModel } from '@/database/models/scm';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import type { ScmChangeRequestItem } from '@/database/schemas';
import { works } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { AiAgentService } from '@/server/services/aiAgent';
import { AcceptanceService } from '@/server/services/verify/acceptanceService';

import {
  fetchGitHubJobLogTail,
  fetchGitHubReviewFeedback,
  postGitHubPullRequestComment,
} from './github/app';
import type { ScmInboundEvent } from './types';
import { buildCiFailurePrompt, buildReviewPrompt, type ScmWakeReason } from './wakePrompt';

const log = debug('lobe-server:scm:control');

/** Wakes per change request before the loop hands over to a human. */
export const SCM_MAX_WAKES = 3;
/** Window in which repeated events on one change request collapse into one wake. */
const WAKE_DEBOUNCE_SECONDS = 60;
/** How far back review feedback is collected for a wake. */
const REVIEW_LOOKBACK_MS = 15 * 60 * 1000;

export interface ScmControlEvent {
  event: Extract<ScmInboundEvent, { type: 'change_request' | 'checks' | 'review' }>;
  kind: string;
  row: ScmChangeRequestItem;
}

export type ScmControlOutcome =
  | { detail?: string; outcome: 'accepted'; acceptanceId: string }
  | { commentId: string; outcome: 'commented' }
  | { detail?: string; outcome: 'skipped' }
  | { operationId: string; outcome: 'woken'; reason: ScmWakeReason };

/**
 * The control half of the closed loop, plugged into
 * `ScmIngestService.onChangeRequestEvent`. Two behaviours:
 *
 * - **merged** → the linked acceptance is accepted (merging is the strongest
 *   signal a user can give) and the registered Work flips to merged. With
 *   stacked pull requests, every linked open PR must be merged or closed
 *   before the acceptance closes.
 * - **ci_failed / review_changes_requested / review_commented** → the agent
 *   that opened the PR is woken in its conversation with the failing checks
 *   (plus job log tails) or the review feedback. Capped at
 *   {@link SCM_MAX_WAKES} per PR and debounced so a burst of check events
 *   becomes one wake; a draft PR never wakes anyone.
 */
export class ScmControlService {
  constructor(private db: LobeChatDatabase) {}

  handle = async ({ event, kind, row }: ScmControlEvent): Promise<ScmControlOutcome> => {
    switch (kind) {
      case 'opened':
      case 'ready_for_review':
      case 'reopened':
      case 'synchronized': {
        return this.commentOnce(row);
      }
      case 'merged': {
        if (!(await this.isEnabled(row, 'acceptOnMerge'))) {
          return { detail: 'acceptOnMerge is off', outcome: 'skipped' };
        }
        return this.onMerged(row);
      }
      case 'ci_failed': {
        if (!(await this.isEnabled(row, 'wakeOnCiFailure'))) {
          return { detail: 'wakeOnCiFailure is off', outcome: 'skipped' };
        }
        return this.wake(row, kind);
      }
      case 'review_changes_requested':
      case 'review_commented': {
        // A comment by the PR author (or the agent acting as them) is not
        // feedback to act on.
        if (event.type === 'review' && event.actor?.login === row.authorExternalLogin) {
          return { detail: 'self comment', outcome: 'skipped' };
        }
        if (!(await this.isEnabled(row, 'wakeOnReview'))) {
          return { detail: 'wakeOnReview is off', outcome: 'skipped' };
        }
        return this.wake(row, kind);
      }
      default: {
        return { detail: `${kind} needs no action`, outcome: 'skipped' };
      }
    }
  };

  /**
   * The automation switches on Settings → Integrations → GitHub, read from
   * the preference of the user who connected the installation. Absent means
   * on: the closed loop is the default and the switch is the opt-out.
   */
  private isEnabled = async (
    row: ScmChangeRequestItem,
    key: keyof GithubIntegrationPreference,
  ): Promise<boolean> => (await this.preference(row))?.[key] !== false;

  private preference = async (
    row: ScmChangeRequestItem,
  ): Promise<GithubIntegrationPreference | undefined> =>
    (await new UserModel(this.db, row.userId).getUserPreference())?.integration?.github;

  // --------------- link comment ---------------

  /**
   * Once per pull request, leave a comment pointing at the LobeHub side of
   * it: the acceptance it delivers and the conversation that opened it. Only
   * when at least one link exists (a bare "tracked" comment says nothing),
   * and only for the repository visibility the user allowed.
   */
  private commentOnce = async (row: ScmChangeRequestItem): Promise<ScmControlOutcome> => {
    if (row.metadata.lobehubCommentId) return { detail: 'already commented', outcome: 'skipped' };
    if (!row.acceptanceId && !row.topicId)
      return { detail: 'no links to share', outcome: 'skipped' };
    if (!row.installationId) return { detail: 'no installation', outcome: 'skipped' };
    // `opened` and the `synchronize` that follows the first push arrive a
    // second apart and are handled concurrently; the row each handler holds
    // predates the other's write, so a per-row claim decides who comments.
    if (!(await this.claimOnce(`scm:comment:${row.id}`, 300))) {
      return { detail: 'comment already in flight', outcome: 'skipped' };
    }
    const fresh = await ScmChangeRequestModel.findById(this.db, row.id);
    if (fresh?.metadata.lobehubCommentId)
      return { detail: 'already commented', outcome: 'skipped' };

    const isPrivate = row.metadata.repoPrivate;
    if (isPrivate === undefined)
      return { detail: 'repository visibility unknown', outcome: 'skipped' };
    const key = isPrivate ? 'commentOnPrivateRepositories' : 'commentOnPublicRepositories';
    const preference = await this.preference(row);
    const allowed = isPrivate ? preference?.[key] !== false : preference?.[key] === true;
    if (!allowed) return { detail: `${key} is off`, outcome: 'skipped' };

    const installationId = await this.providerInstallationId(row.installationId);
    if (!installationId) return { detail: 'installation not found', outcome: 'skipped' };

    const origin = appEnv.APP_URL.replace(/\/$/, '');
    const lines = ['**LobeHub** is tracking this pull request.', ''];
    if (row.acceptanceId) lines.push(`- Acceptance: ${origin}/acceptance/${row.acceptanceId}`);
    if (row.topicId) {
      const topic = await new TopicModel(
        this.db,
        row.userId,
        row.workspaceId ?? undefined,
      ).findById(row.topicId);
      if (topic?.agentId)
        lines.push(`- Conversation: ${origin}/agent/${topic.agentId}?topic=${row.topicId}`);
    }
    lines.push(
      '',
      'Merging accepts the delivery; a failing check or review feedback reaches the agent that opened it.',
    );

    const commentId = await postGitHubPullRequestComment({
      body: lines.join('\n'),
      installationId,
      number: row.number,
      repoFullName: row.repoFullName,
    });
    if (!commentId) return { detail: 'comment failed', outcome: 'skipped' };

    await ScmChangeRequestModel.upsert(this.db, {
      metadata: { lobehubCommentId: commentId },
      number: row.number,
      provider: row.provider,
      repoFullName: row.repoFullName,
      state: row.state,
      url: row.url,
      userId: row.userId,
      workspaceId: row.workspaceId,
    });
    log('commented on %s#%d (%s)', row.repoFullName, row.number, commentId);
    return { commentId, outcome: 'commented' };
  };

  // --------------- merge → accepted ---------------

  private onMerged = async (row: ScmChangeRequestItem): Promise<ScmControlOutcome> => {
    if (row.workId) {
      await this.db.update(works).set({ status: 'merged' }).where(eq(works.id, row.workId));
    }
    if (!row.acceptanceId) return { detail: 'no linked acceptance', outcome: 'skipped' };

    // Stacked PRs: the acceptance closes when the last linked PR lands.
    const siblings = await ScmChangeRequestModel.listByAcceptance(this.db, row.acceptanceId);
    const pending = siblings.filter((s) => s.state === 'open');
    if (pending.length > 0) {
      return {
        detail: `${pending.length} linked pull request(s) still open`,
        outcome: 'skipped',
      };
    }

    const service = new AcceptanceService(this.db, row.userId, row.workspaceId ?? undefined);
    const accepted = await service.acceptFromScmMerge(row.acceptanceId, {
      mergedByExternalId: row.mergedByExternalId ?? undefined,
      number: row.number,
      provider: row.provider,
      repoFullName: row.repoFullName,
      url: row.url,
    });
    if (!accepted) return { detail: 'acceptance no longer exists', outcome: 'skipped' };
    return { acceptanceId: accepted.id, outcome: 'accepted' };
  };

  // --------------- CI / review → wake ---------------

  private wake = async (
    row: ScmChangeRequestItem,
    reason: ScmWakeReason,
  ): Promise<ScmControlOutcome> => {
    if (row.isDraft) return { detail: 'draft pull request', outcome: 'skipped' };
    if (row.state !== 'open') return { detail: `pull request is ${row.state}`, outcome: 'skipped' };
    if (!row.topicId) return { detail: 'no linked conversation', outcome: 'skipped' };
    if (row.wakeCount >= SCM_MAX_WAKES) {
      return { detail: `wake cap (${SCM_MAX_WAKES}) reached`, outcome: 'skipped' };
    }
    if (!(await this.claimWakeWindow(row.id))) {
      return { detail: 'debounced', outcome: 'skipped' };
    }

    const topicModel = new TopicModel(this.db, row.userId, row.workspaceId ?? undefined);
    const topic = await topicModel.findById(row.topicId);
    if (!topic?.agentId) return { detail: 'conversation has no agent', outcome: 'skipped' };

    const prompt = await this.buildPrompt(row, reason);
    const running = Boolean(topic.metadata?.runningOperation);

    // A busy topic: execAgent's reservation retries briefly for the running
    // turn to hand back (queued-steer semantics); if it does not, the wake is
    // dropped and the next event tries again.
    let operationId: string;
    try {
      const result = await new AiAgentService(this.db, row.userId, {
        workspaceId: row.workspaceId ?? undefined,
      }).execAgent({
        agentId: topic.agentId,
        appContext: { topicId: row.topicId },
        autoStart: true,
        externalOrigin: {
          kind: reason,
          label: `${row.repoFullName}#${row.number}`,
          provider: row.provider,
          resourceId: row.id,
          url: row.url,
        },
        prompt,
        steer: running,
        trigger: RequestTrigger.Scm,
        userInterventionConfig: { approvalMode: 'headless' },
      });
      operationId = result.operationId;
    } catch (error) {
      log('wake %s on %s failed: %O', reason, row.id, error);
      return {
        detail: `wake failed: ${error instanceof Error ? error.message : String(error)}`,
        outcome: 'skipped',
      };
    }

    const count = await ScmChangeRequestModel.recordWake(this.db, row.id);
    log(
      'woke agent %s in topic %s for %s (%s#%d, wake %d/%d, op %s)',
      topic.agentId,
      row.topicId,
      reason,
      row.repoFullName,
      row.number,
      count,
      SCM_MAX_WAKES,
      operationId,
    );
    return { operationId, outcome: 'woken', reason };
  };

  private buildPrompt = async (row: ScmChangeRequestItem, reason: ScmWakeReason) => {
    if (reason === 'ci_failed') {
      const logs: Record<string, string | null> = {};
      if (row.installationId) {
        const installationId = await this.providerInstallationId(row.installationId);
        for (const check of row.checks ?? []) {
          if (check.status !== 'completed' || check.conclusion === 'success') continue;
          const jobId = check.externalId.startsWith('check_run:')
            ? check.externalId.slice('check_run:'.length)
            : null;
          logs[check.externalId] =
            installationId && jobId
              ? await fetchGitHubJobLogTail({
                  installationId,
                  jobId,
                  repoFullName: row.repoFullName,
                })
              : null;
        }
      }
      return buildCiFailurePrompt({ logs, row });
    }

    const installationId = row.installationId
      ? await this.providerInstallationId(row.installationId)
      : null;
    const feedback = installationId
      ? await fetchGitHubReviewFeedback({
          installationId,
          number: row.number,
          repoFullName: row.repoFullName,
          since: new Date(Date.now() - REVIEW_LOOKBACK_MS),
        })
      : [];
    return buildReviewPrompt({ feedback, reason, row });
  };

  /** Provider-side installation id for a `scm_installations` row id. */
  private providerInstallationId = async (installationRowId: string) => {
    const installation = await ScmInstallationModel.findById(this.db, installationRowId);
    return installation?.installationId ?? null;
  };

  /** One wake per change request per window; Redis-less deployments never debounce. */
  private claimWakeWindow = (changeRequestId: string): Promise<boolean> =>
    this.claimOnce(`scm:wake:${changeRequestId}`, WAKE_DEBOUNCE_SECONDS);

  /** Redis SETNX with a TTL; without Redis every claim succeeds. */
  private claimOnce = async (key: string, ttlSeconds: number): Promise<boolean> => {
    const redis = getAgentRuntimeRedisClient();
    if (!redis) return true;
    const claimed = await redis.set(key, '1', 'EX', ttlSeconds, 'NX');
    return claimed === 'OK';
  };
}
