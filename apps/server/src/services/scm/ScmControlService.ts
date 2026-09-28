import type { GithubIntegrationPreference } from '@lobechat/types';
import { isTrustedScmReviewer, RequestTrigger } from '@lobechat/types';
import debug from 'debug';
import { eq } from 'drizzle-orm';

import { isFailingCheck, ScmChangeRequestModel, ScmInstallationModel } from '@/database/models/scm';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import type { ScmChangeRequestItem } from '@/database/schemas';
import { acceptances, works, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { AiAgentService } from '@/server/services/aiAgent';
import { AcceptanceService } from '@/server/services/verify/acceptanceService';

import type { GitHubReviewFeedback } from './github/app';
import {
  fetchGitHubJobLogTail,
  fetchGitHubReviewFeedback,
  postGitHubPullRequestComment,
  updateGitHubPullRequestComment,
} from './github/app';
import { canWriteScmScope } from './scope';
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

/** The automation switch each wake reason answers to. */
const WAKE_PREFERENCE: Record<ScmWakeReason, keyof GithubIntegrationPreference> = {
  ci_failed: 'wakeOnCiFailure',
  review_changes_requested: 'wakeOnReview',
  review_commented: 'wakeOnReview',
};

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

  handle = async (params: ScmControlEvent): Promise<ScmControlOutcome> => {
    // An author-routed row points into whatever scope the author's records
    // live in, and that was decided when the pull request opened. Checks and
    // reviews reuse the stored row, so without asking again a member who
    // has since left — or been made a viewer — would still get merges
    // accepting and failures waking runs in that workspace.
    if (!(await this.ownerCanStillWrite(params.row))) {
      // The gate is for what we do on the author's behalf. The Work row only
      // records what GitHub reported, and a merge left unmirrored would sit
      // in the workspace as an open Work forever.
      if (params.kind === 'merged') await this.mirrorMerge(params.row);
      return { detail: 'owner can no longer write to this workspace', outcome: 'skipped' };
    }

    const outcome = await this.route(params);
    // A failure the debounce window swallowed rides along with the next
    // event, whatever that event was.
    if (outcome.outcome !== 'woken') await this.flushPendingWake(params.row.id);
    return outcome;
  };

  private route = async ({ event, kind, row }: ScmControlEvent): Promise<ScmControlOutcome> => {
    switch (kind) {
      case 'opened':
      case 'ready_for_review':
      case 'reopened':
      case 'synchronized': {
        return this.syncComment(row);
      }
      case 'merged': {
        // The Work row mirrors what GitHub says about the pull request, so
        // it follows the merge whatever the automation switches say; only
        // the acceptance verdict is opt-out.
        await this.mirrorMerge(row);
        if (!(await this.isEnabled(row, 'acceptOnMerge'))) {
          return { detail: 'acceptOnMerge is off', outcome: 'skipped' };
        }
        const outcome = await this.onMerged(row);
        await this.refreshComment(row.id);
        return outcome;
      }
      case 'ci_failed': {
        if (!(await this.isEnabled(row, WAKE_PREFERENCE[kind]))) {
          return { detail: `${WAKE_PREFERENCE[kind]} is off`, outcome: 'skipped' };
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
        // Review text becomes the prompt of an unattended run with tools, so
        // only someone the repository already trusts may steer it. Anyone
        // else is still free to comment; their words just do not become
        // instructions.
        const actor = event.type === 'review' ? event.actor : undefined;
        const association = actor?.association;
        if (!actor || !association || !isTrustedScmReviewer(actor)) {
          return { detail: `reviewer is ${association ?? 'unknown'}`, outcome: 'skipped' };
        }
        if (!(await this.isEnabled(row, WAKE_PREFERENCE[kind]))) {
          return { detail: `${WAKE_PREFERENCE[kind]} is off`, outcome: 'skipped' };
        }
        // The webhook already carries the text that triggered this wake, and
        // it is the only copy we are sure of: the list endpoint can be rate
        // limited, fail, or not show the review yet. Carry it along so the
        // agent is never woken with "the review carried no text".
        const trigger: GitHubReviewFeedback | undefined =
          event.type === 'review' && event.review.body?.trim()
            ? {
                association,
                author: event.actor?.login ?? 'unknown',
                body: event.review.body,
                line: event.review.line,
                path: event.review.path,
                submittedAt: event.occurredAt?.toISOString(),
                url: event.review.url ?? undefined,
              }
            : undefined;
        return this.wakeAndRefresh(row, kind, trigger);
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

  private ownerCanStillWrite = async (row: ScmChangeRequestItem): Promise<boolean> =>
    row.metadata?.routedBy !== 'author' ||
    !row.workspaceId ||
    canWriteScmScope(this.db, row.userId, row.workspaceId);

  private conversationIsInstallers = async (row: ScmChangeRequestItem): Promise<boolean> => {
    if (row.metadata?.routedBy !== 'author' || !row.installationId) return true;
    const installation = await ScmInstallationModel.findById(this.db, row.installationId);
    if (!installation) return false;
    // Inside the installation's own workspace the conversation is the
    // tenant's; anywhere else it is only the installer's if it is theirs.
    return installation.workspaceId
      ? row.workspaceId === installation.workspaceId
      : !row.workspaceId && row.userId === installation.userId;
  };

  /** The Work row mirrors GitHub; it follows a merge whatever else is decided. */
  private mirrorMerge = async (row: ScmChangeRequestItem): Promise<void> => {
    if (!row.workId) return;
    await this.db.update(works).set({ status: 'merged' }).where(eq(works.id, row.workId));
  };

  /**
   * The switches belong to whoever connected the installation, not to the
   * row's owner. With author routing those are different people, and an
   * installer's explicit opt-out — no accepting on merge, no comments on
   * private repositories — must not be undone by an author's defaults.
   */
  private preference = async (
    row: ScmChangeRequestItem,
  ): Promise<GithubIntegrationPreference | undefined> => {
    const installation = row.installationId
      ? await ScmInstallationModel.findById(this.db, row.installationId)
      : null;
    const userId = installation?.userId ?? row.userId;
    return (await new UserModel(this.db, userId).getUserPreference())?.integration?.github;
  };

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
    // predates the other's write, so the claim decides who posts. It has to
    // be the database's: posting is irreversible, and a Redis-less
    // deployment would otherwise leave an orphan comment nothing updates.
    if (!(await ScmChangeRequestModel.claimCommentSlot(this.db, row.id))) {
      const fresh = await ScmChangeRequestModel.findById(this.db, row.id);
      if (fresh?.metadata.lobehubCommentId)
        return this.updateComment(fresh, fresh.metadata.lobehubCommentId);
      return { detail: 'comment already in flight', outcome: 'skipped' };
    }
    const fresh = await ScmChangeRequestModel.findById(this.db, row.id);

    const installationId = await this.providerInstallationId(row.installationId);
    if (!installationId) {
      await ScmChangeRequestModel.releaseCommentSlot(this.db, row.id);
      return { detail: 'installation not found', outcome: 'skipped' };
    }

    const commentId = await postGitHubPullRequestComment({
      body: await this.buildCommentBody(fresh ?? row),
      installationId,
      number: row.number,
      repoFullName: row.repoFullName,
    });
    if (!commentId) {
      await ScmChangeRequestModel.releaseCommentSlot(this.db, row.id);
      return { detail: 'comment failed', outcome: 'skipped' };
    }

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
    // An author-routed pull request can link someone's personal
    // conversation, while the comment is posted under the installer's
    // switches onto a repository that person does not control. Its title
    // and address are theirs to publish, not the installer's, so the
    // comment names a conversation only when it belongs to the tenant that
    // connected the installation.
    if (row.topicId && (await this.conversationIsInstallers(row))) {
      const topic = await new TopicModel(
        this.db,
        row.userId,
        row.workspaceId ?? undefined,
      ).findById(row.topicId);
      if (topic?.agentId) {
        // A workspace agent only resolves under its workspace prefix; the
        // acceptance link stays global.
        const slug = row.workspaceId ? await this.workspaceSlug(row.workspaceId) : null;
        conversation = {
          title: topic.title,
          url: `${origin}${slug ? `/${slug}` : ''}/agent/${topic.agentId}/${row.topicId}`,
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
    trigger?: GitHubReviewFeedback,
  ): Promise<ScmControlOutcome> => {
    const outcome = await this.wake(row, reason, trigger);
    if (outcome.outcome === 'woken') await this.refreshComment(row.id);
    return outcome;
  };

  /**
   * Deliver a wake the debounce window swallowed. Called after every event
   * on a change request, so the last failure of a burst reaches the agent
   * on the next delivery instead of waiting for an unrelated one. The wake
   * itself re-reads the row, so the prompt carries every failing check by
   * then — not just the one that was dropped.
   */
  private flushPendingWake = async (rowId: string): Promise<void> => {
    const fresh = await ScmChangeRequestModel.findById(this.db, rowId);
    const pending = fresh?.metadata.pendingWake;
    if (!fresh || !pending) return;

    const reason = pending.reason as ScmWakeReason;
    // The marker outlives the window it was written in, and the user may
    // have turned the automation off in between. `route()` guards the
    // direct path; this one has to ask the same question, or an explicit
    // opt-out would still be followed by a headless run.
    const preference = WAKE_PREFERENCE[reason];
    if (preference && !(await this.isEnabled(fresh, preference))) {
      await ScmChangeRequestModel.clearPendingWake(this.db, rowId);
      return;
    }

    const outcome = await this.wake(fresh, reason);
    // Still inside the window: leave the marker for the next delivery.
    if (outcome.outcome === 'skipped' && outcome.detail === 'debounced') return;

    await ScmChangeRequestModel.clearPendingWake(this.db, rowId);
    if (outcome.outcome === 'woken') await this.refreshComment(rowId);
  };

  private wake = async (
    row: ScmChangeRequestItem,
    reason: ScmWakeReason,
    trigger?: GitHubReviewFeedback,
  ): Promise<ScmControlOutcome> => {
    if (row.isDraft) return { detail: 'draft pull request', outcome: 'skipped' };
    if (row.state !== 'open') return { detail: `pull request is ${row.state}`, outcome: 'skipped' };
    if (!row.topicId) return { detail: 'no linked conversation', outcome: 'skipped' };
    // An early out on the snapshot so a capped pull request does not pay for
    // job logs; the cap itself is enforced by the reservation further down.
    if (row.wakeCount >= SCM_MAX_WAKES) {
      return { detail: `wake cap (${SCM_MAX_WAKES}) reached`, outcome: 'skipped' };
    }
    if (!(await this.claimWakeWindow(row.id))) {
      // The burst is collapsed into the wake already in flight, but the
      // prompt was built before this event landed. Remember it so the next
      // delivery on this pull request carries it rather than dropping it.
      await ScmChangeRequestModel.markPendingWake(this.db, row.id, reason);
      return { detail: 'debounced', outcome: 'skipped' };
    }

    const topicModel = new TopicModel(this.db, row.userId, row.workspaceId ?? undefined);
    const topic = await topicModel.findById(row.topicId);
    if (!topic?.agentId) return { detail: 'conversation has no agent', outcome: 'skipped' };

    const prompt = await this.buildPrompt(row, reason, trigger);
    const running = Boolean(topic.metadata?.runningOperation);

    // Take the slot before starting anything: the check above read a row
    // snapshot, and on a Redis-less deployment there is no debounce to stop
    // two deliveries from passing it together. Handed back below if the run
    // never starts.
    const count = await ScmChangeRequestModel.reserveWake(this.db, row.id, SCM_MAX_WAKES, reason);
    if (count === null) {
      return { detail: `wake cap (${SCM_MAX_WAKES}) reached`, outcome: 'skipped' };
    }

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
      await ScmChangeRequestModel.releaseWake(this.db, row.id);
      return {
        detail: `wake failed: ${error instanceof Error ? error.message : String(error)}`,
        outcome: 'skipped',
      };
    }

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

  private buildPrompt = async (
    row: ScmChangeRequestItem,
    reason: ScmWakeReason,
    trigger?: GitHubReviewFeedback,
  ) => {
    if (reason === 'ci_failed') {
      const logs: Record<string, string | null> = {};
      if (row.installationId) {
        const installationId = await this.providerInstallationId(row.installationId);
        for (const check of row.checks ?? []) {
          if (!isFailingCheck(check)) continue;
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
    // The window may also hold comments from people the repository does not
    // trust; the agent is told about the trusted ones only.
    const trusted = feedback.filter((item) =>
      isTrustedScmReviewer({ association: item.association, login: item.author }),
    );
    const known = new Set(trusted.map((item) => item.url ?? `${item.author}:${item.body}`));
    const all =
      trigger && !known.has(trigger.url ?? `${trigger.author}:${trigger.body}`)
        ? [...trusted, trigger]
        : trusted;

    return buildReviewPrompt({
      feedback: all.sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? '')),
      reason,
      row,
    });
  };

  /** Slug the workspace-aware routes are mirrored under, for links we hand to GitHub. */
  private workspaceSlug = async (workspaceId: string): Promise<string | null> => {
    const [row] = await this.db
      .select({ slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    return row?.slug ?? null;
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
