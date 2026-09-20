import type { GithubIntegrationPreference } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';
import { eq } from 'drizzle-orm';

import { ScmChangeRequestModel, ScmInstallationModel } from '@/database/models/scm';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import type { ScmChangeRequestItem } from '@/database/schemas';
import { acceptances, works } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { AiAgentService } from '@/server/services/aiAgent';
import { AcceptanceService } from '@/server/services/verify/acceptanceService';

import {
  fetchGitHubJobLogTail,
  fetchGitHubReviewFeedback,
  postGitHubPullRequestComment,
  updateGitHubPullRequestComment,
} from './github/app';
import { buildTrackingComment } from './trackingComment';
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
  | { commentId: string; outcome: 'commented'; updated: boolean }
  | { detail?: string; outcome: 'skipped' }
  | { operationId: string; outcome: 'woken'; reason: ScmWakeReason };

/**
 * The control half of the closed loop, plugged into
 * `ScmIngestService.onChangeRequestEvent`. Two behaviours:
 *
 * - **opened / synchronized / …** → one tracking comment on the pull request,
 *   linking the acceptance and the conversation, rewritten in place as the
 *   loop moves.
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
        return this.syncComment(row);
      }
      case 'merged': {
        if (!(await this.isEnabled(row, 'acceptOnMerge'))) {
          return { detail: 'acceptOnMerge is off', outcome: 'skipped' };
        }
        const outcome = await this.onMerged(row);
        await this.refreshComment(row.id);
        return outcome;
      }
      case 'ci_failed': {
        if (!(await this.isEnabled(row, 'wakeOnCiFailure'))) {
          return { detail: 'wakeOnCiFailure is off', outcome: 'skipped' };
        }
        return this.wakeAndRefresh(row, kind);
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
        return this.wakeAndRefresh(row, kind);
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

  // --------------- tracking comment ---------------

  /**
   * One comment per pull request, kept current: it links the acceptance it
   * delivers and the conversation that opened it, and its status table is
   * rewritten as the acceptance moves and the agent gets notified. Posted
   * only when at least one link exists (a bare "tracked" comment says
   * nothing) and only for the repository visibility the user allowed; once
   * posted, later events update it in place.
   */
  private syncComment = async (row: ScmChangeRequestItem): Promise<ScmControlOutcome> => {
    if (!row.acceptanceId && !row.topicId)
      return { detail: 'no links to share', outcome: 'skipped' };
    if (!row.installationId) return { detail: 'no installation', outcome: 'skipped' };
    if (row.metadata.lobehubCommentId)
      return this.updateComment(row, row.metadata.lobehubCommentId);

    const isPrivate = row.metadata.repoPrivate;
    if (isPrivate === undefined)
      return { detail: 'repository visibility unknown', outcome: 'skipped' };
    const key = isPrivate ? 'commentOnPrivateRepositories' : 'commentOnPublicRepositories';
    const preference = await this.preference(row);
    const allowed = isPrivate ? preference?.[key] !== false : preference?.[key] === true;
    if (!allowed) return { detail: `${key} is off`, outcome: 'skipped' };

    // `opened` and the `synchronize` that follows the first push arrive a
    // second apart and are handled concurrently; the row each handler holds
    // predates the other's write, so a per-row claim decides who posts.
    if (!(await this.claimOnce(`scm:comment:${row.id}`, 300))) {
      return { detail: 'comment already in flight', outcome: 'skipped' };
    }
    const fresh = await ScmChangeRequestModel.findById(this.db, row.id);
    if (fresh?.metadata.lobehubCommentId)
      return this.updateComment(fresh, fresh.metadata.lobehubCommentId);

    const installationId = await this.providerInstallationId(row.installationId);
    if (!installationId) return { detail: 'installation not found', outcome: 'skipped' };

    const commentId = await postGitHubPullRequestComment({
      body: await this.buildCommentBody(fresh ?? row),
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
    return { commentId, outcome: 'commented', updated: false };
  };

  private updateComment = async (
    row: ScmChangeRequestItem,
    commentId: string,
  ): Promise<ScmControlOutcome> => {
    if (!row.installationId) return { detail: 'no installation', outcome: 'skipped' };
    const installationId = await this.providerInstallationId(row.installationId);
    if (!installationId) return { detail: 'installation not found', outcome: 'skipped' };

    const updated = await updateGitHubPullRequestComment({
      body: await this.buildCommentBody(row),
      commentId,
      installationId,
      repoFullName: row.repoFullName,
    });
    if (!updated) return { detail: 'comment update failed', outcome: 'skipped' };
    log('updated comment %s on %s#%d', commentId, row.repoFullName, row.number);
    return { commentId, outcome: 'commented', updated: true };
  };

  /** After a merge or a wake: re-read the row and rewrite the comment, if there is one. */
  private refreshComment = async (rowId: string) => {
    const fresh = await ScmChangeRequestModel.findById(this.db, rowId);
    if (!fresh?.metadata.lobehubCommentId) return;
    await this.updateComment(fresh, fresh.metadata.lobehubCommentId);
  };

  private buildCommentBody = async (row: ScmChangeRequestItem): Promise<string> => {
    const origin = appEnv.APP_URL.replace(/\/$/, '');

    let acceptance: {
      id: string;
      status: (typeof acceptances.$inferSelect)['status'];
      url: string;
    } | null = null;
    if (row.acceptanceId) {
      const [found] = await this.db
        .select({ id: acceptances.id, status: acceptances.status })
        .from(acceptances)
        .where(eq(acceptances.id, row.acceptanceId));
      if (found) acceptance = { ...found, url: `${origin}/acceptance/${found.id}` };
    }

    let conversation: { title?: string | null; url: string } | null = null;
    if (row.topicId) {
      const topic = await new TopicModel(
        this.db,
        row.userId,
        row.workspaceId ?? undefined,
      ).findById(row.topicId);
      if (topic?.agentId) {
        conversation = {
          title: topic.title,
          url: `${origin}/agent/${topic.agentId}?topic=${row.topicId}`,
        };
      }
    }

    return buildTrackingComment({
      acceptance,
      conversation,
      marker: {
        acceptanceId: row.acceptanceId ?? undefined,
        changeRequestId: row.id,
        provider: row.provider,
        topicId: row.topicId ?? undefined,
        v: 1,
      },
      notification:
        row.wakeCount > 0
          ? { count: row.wakeCount, max: SCM_MAX_WAKES, reason: row.metadata.lastWake?.reason }
          : null,
      updatedAt: new Date(),
    });
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

  private wakeAndRefresh = async (
    row: ScmChangeRequestItem,
    reason: ScmWakeReason,
  ): Promise<ScmControlOutcome> => {
    const outcome = await this.wake(row, reason);
    if (outcome.outcome === 'woken') await this.refreshComment(row.id);
    return outcome;
  };

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

    const count = await ScmChangeRequestModel.recordWake(this.db, row.id, reason);
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
