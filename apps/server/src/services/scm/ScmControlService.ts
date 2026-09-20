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
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { AiAgentService } from '@/server/services/aiAgent';
import { AcceptanceService } from '@/server/services/verify/acceptanceService';

import { fetchGitHubJobLogTail, fetchGitHubReviewFeedback } from './github/app';
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
  ): Promise<boolean> => {
    const preference = await new UserModel(this.db, row.userId).getUserPreference();
    return preference?.integration?.github?.[key] !== false;
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
      mergedByExternalLogin: row.mergedByExternalId ?? undefined,
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
  private claimWakeWindow = async (changeRequestId: string): Promise<boolean> => {
    const redis = getAgentRuntimeRedisClient();
    if (!redis) return true;
    const claimed = await redis.set(
      `scm:wake:${changeRequestId}`,
      '1',
      'EX',
      WAKE_DEBOUNCE_SECONDS,
      'NX',
    );
    return claimed === 'OK';
  };
}
