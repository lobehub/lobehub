import type { ScmReviewDecision } from '@lobechat/types';
import debug from 'debug';

import { isFailingCheck, ScmChangeRequestModel, ScmInstallationModel } from '@/database/models/scm';
import type { ScmChangeRequestItem, ScmInstallationItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { resolveChangeRequestLinks } from './links';
import type { ScmInboundEvent, ScmIngestOutcome } from './types';

const log = debug('lobe-server:scm:ingest');

/**
 * Apply one normalized provider event to the database. This is the whole
 * "state" half of the closed loop: installations, change requests, CI
 * rollups and review decisions end up in `scm_*` tables. The "control"
 * half (accept the acceptance on merge, wake the agent on CI failure) hangs
 * off {@link ScmIngestService.onChangeRequestEvent} and ships separately.
 *
 * Every branch is idempotent: replaying a delivery converges to the same
 * rows, which is what lets the delivery ledger reject duplicates cheaply
 * instead of guarding each write.
 */
export class ScmIngestService {
  constructor(private db: LobeChatDatabase) {}

  /**
   * Hook for the control half: called after a change-request-level event
   * has been persisted, with the row it landed on. Default is a no-op.
   */
  onChangeRequestEvent: (params: {
    event: Extract<ScmInboundEvent, { type: 'change_request' | 'checks' | 'review' }>;
    kind: string;
    row: ScmChangeRequestItem;
  }) => Promise<void> = async () => {};

  apply = async (event: ScmInboundEvent): Promise<ScmIngestOutcome> => {
    switch (event.type) {
      case 'ignored': {
        return { detail: event.reason, status: 'skipped' };
      }
      case 'installation': {
        return this.applyInstallation(event);
      }
      case 'installation_repositories': {
        return this.applyInstallationRepositories(event);
      }
      case 'change_request': {
        return this.applyChangeRequest(event);
      }
      case 'checks': {
        return this.applyChecks(event);
      }
      case 'review': {
        return this.applyReview(event);
      }
    }
  };

  // --------------- Installations ---------------

  /**
   * Webhook-side installation lifecycle. A `created` event for an
   * installation LobeHub has never bound is *not* inserted: the row needs a
   * LobeHub user, which only the install callback knows. Until that
   * callback runs, events for the installation are skipped as unbound.
   */
  private applyInstallation = async (
    event: Extract<ScmInboundEvent, { type: 'installation' }>,
  ): Promise<ScmIngestOutcome> => {
    const { installation, action } = event;
    const existing = await ScmInstallationModel.findByProviderInstallationId(
      this.db,
      installation.provider,
      installation.installationId,
    );

    if (!existing) {
      return {
        detail: `installation ${installation.installationId} is not bound to a LobeHub scope`,
        status: 'skipped',
      };
    }

    switch (action) {
      case 'deleted': {
        await ScmInstallationModel.markRevoked(this.db, existing.id);
        break;
      }
      case 'suspend': {
        await ScmInstallationModel.setSuspended(this.db, existing.id, true);
        break;
      }
      case 'unsuspend': {
        await ScmInstallationModel.setSuspended(this.db, existing.id, false);
        break;
      }
      case 'created':
      case 'new_permissions_accepted': {
        await ScmInstallationModel.refreshSnapshot(this.db, existing.id, {
          accountExternalId: installation.accountExternalId,
          accountLogin: installation.accountLogin,
          accountType: installation.accountType,
          metadata: { ...existing.metadata, ...installation.metadata },
          repositories: installation.repositories?.length
            ? installation.repositories
            : existing.repositories,
          repositorySelection: installation.repositorySelection,
          suspendedAt: installation.suspendedAt ?? null,
        });
        break;
      }
    }

    return { detail: `installation ${existing.id} ${action}`, status: 'processed' };
  };

  private applyInstallationRepositories = async (
    event: Extract<ScmInboundEvent, { type: 'installation_repositories' }>,
  ): Promise<ScmIngestOutcome> => {
    const existing = await ScmInstallationModel.findByProviderInstallationId(
      this.db,
      'github',
      event.installationId,
    );
    if (!existing) {
      return { detail: `installation ${event.installationId} is not bound`, status: 'skipped' };
    }

    const removed = new Set(event.removed.map((r) => r.externalId));
    const kept = existing.repositories.filter((r) => !removed.has(r.externalId));
    const known = new Set(kept.map((r) => r.externalId));
    const next = [...kept, ...event.added.filter((r) => !known.has(r.externalId))];

    await ScmInstallationModel.setRepositories(this.db, existing.id, next);
    return {
      detail: `installation ${existing.id}: +${event.added.length} -${event.removed.length}`,
      status: 'processed',
    };
  };

  // --------------- Change requests ---------------

  private resolveBoundInstallation = async (
    installationId: string,
  ): Promise<ScmInstallationItem | null> => {
    const installation = await ScmInstallationModel.findByProviderInstallationId(
      this.db,
      'github',
      installationId,
    );
    if (!installation || installation.revokedAt) return null;
    return installation;
  };

  private applyChangeRequest = async (
    event: Extract<ScmInboundEvent, { type: 'change_request' }>,
  ): Promise<ScmIngestOutcome> => {
    const installation = await this.resolveBoundInstallation(event.installationId);
    if (!installation) {
      return { detail: `installation ${event.installationId} is not bound`, status: 'skipped' };
    }

    const scope = { userId: installation.userId, workspaceId: installation.workspaceId };
    const links = await resolveChangeRequestLinks(this.db, {
      body: event.body,
      number: event.changeRequest.number,
      repoFullName: event.changeRequest.repoFullName,
      scope,
      url: event.changeRequest.url,
    });

    const row = await ScmChangeRequestModel.upsert(this.db, {
      ...event.changeRequest,
      eventAt: event.occurredAt,
      eventKind: event.kind,
      links: { ...links, installationId: installation.id },
      userId: scope.userId,
      workspaceId: scope.workspaceId,
    });

    log(
      '%s %s#%d -> %s (acceptance=%s topic=%s)',
      event.kind,
      row.repoFullName,
      row.number,
      row.id,
      row.acceptanceId ?? '-',
      row.topicId ?? '-',
    );

    await this.onChangeRequestEvent({ event, kind: event.kind, row });
    return { detail: `${row.id} ${event.kind}`, status: 'processed' };
  };

  private applyChecks = async (
    event: Extract<ScmInboundEvent, { type: 'checks' }>,
  ): Promise<ScmIngestOutcome> => {
    const installation = await this.resolveBoundInstallation(event.installationId);
    if (!installation) {
      return { detail: `installation ${event.installationId} is not bound`, status: 'skipped' };
    }

    // Resolve target rows: by number when the provider attached them, else by head sha.
    const rows: ScmChangeRequestItem[] = [];
    for (const number of event.numbers) {
      const row = await ScmChangeRequestModel.findByIdentity(
        this.db,
        'github',
        event.repoFullName,
        number,
      );
      if (row) rows.push(row);
    }
    if (rows.length === 0) {
      rows.push(
        ...(await ScmChangeRequestModel.findByHeadSha(
          this.db,
          'github',
          event.repoFullName,
          event.headSha,
        )),
      );
    }
    if (rows.length === 0) {
      return {
        detail: `no tracked change request for ${event.repoFullName}@${event.headSha.slice(0, 7)}`,
        status: 'skipped',
      };
    }

    const touched: string[] = [];
    for (const row of rows) {
      const result = await ScmChangeRequestModel.applyChecks(this.db, row.id, {
        checks: event.checks,
        headSha: event.headSha,
      });
      if (!result?.applied) continue;
      touched.push(row.id);

      // Emit per-check failure the moment it lands, and the green rollup once
      // nothing is pending — those two are what the control half acts on.
      const failedNow = event.checks.some(isFailingCheck);
      const kind = failedNow
        ? 'ci_failed'
        : result.ciStatus === 'success' && result.previousCiStatus !== 'success'
          ? 'ci_passed'
          : null;
      if (kind) {
        await ScmChangeRequestModel.recordEvent(this.db, row.id, kind);
        await this.onChangeRequestEvent({ event, kind, row: result.row });
      }
    }

    return touched.length > 0
      ? { detail: touched.join(','), status: 'processed' }
      : { detail: `stale checks for ${event.headSha.slice(0, 7)}`, status: 'skipped' };
  };

  private applyReview = async (
    event: Extract<ScmInboundEvent, { type: 'review' }>,
  ): Promise<ScmIngestOutcome> => {
    const installation = await this.resolveBoundInstallation(event.installationId);
    if (!installation) {
      return { detail: `installation ${event.installationId} is not bound`, status: 'skipped' };
    }

    const row = await ScmChangeRequestModel.findByIdentity(
      this.db,
      'github',
      event.repoFullName,
      event.number,
    );
    if (!row) {
      return {
        detail: `no tracked change request for ${event.repoFullName}#${event.number}`,
        status: 'skipped',
      };
    }

    const decision: ScmReviewDecision | null =
      event.kind === 'review_approved'
        ? 'approved'
        : event.kind === 'review_changes_requested'
          ? 'changes_requested'
          : null;
    // A dismissal clears the aggregate: GitHub says the verdict no longer counts.
    if (event.kind === 'review_dismissed') {
      await ScmChangeRequestModel.setReviewDecision(this.db, row.id, null);
    } else if (decision) {
      await ScmChangeRequestModel.setReviewDecision(this.db, row.id, decision);
    }
    await ScmChangeRequestModel.recordEvent(this.db, row.id, event.kind, event.occurredAt);

    const fresh = (await ScmChangeRequestModel.findById(this.db, row.id)) ?? row;
    await this.onChangeRequestEvent({ event, kind: event.kind, row: fresh });
    return { detail: `${row.id} ${event.kind}`, status: 'processed' };
  };
}
