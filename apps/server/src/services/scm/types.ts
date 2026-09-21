import type {
  ScmChangeRequestEventKind,
  ScmChangeRequestSnapshot,
  ScmCheck,
  ScmInstallationRepository,
  ScmInstallationSnapshot,
  ScmProvider,
} from '@lobechat/types';

/** A provider user as it appears on an event. */
export interface ScmActor {
  externalId: string;
  login: string;
}

/**
 * One inbound webhook delivery, normalized to provider-neutral shape. Every
 * provider adapter produces this union; the ingest service consumes it and
 * never sees a raw payload.
 */
export type ScmInboundEvent =
  | {
      action: 'created' | 'deleted' | 'new_permissions_accepted' | 'suspend' | 'unsuspend';
      installation: ScmInstallationSnapshot;
      type: 'installation';
    }
  | {
      added: ScmInstallationRepository[];
      installationId: string;
      removed: ScmInstallationRepository[];
      type: 'installation_repositories';
    }
  | {
      actor?: ScmActor;
      /** Change request description; acceptance links are parsed out of it. */
      body?: string | null;
      changeRequest: ScmChangeRequestSnapshot;
      installationId: string;
      kind: ScmChangeRequestEventKind;
      occurredAt?: Date;
      type: 'change_request';
    }
  | {
      checks: ScmCheck[];
      headSha: string;
      installationId: string;
      /** Change request numbers the provider attached; empty for fork PRs, resolved by sha then. */
      numbers: number[];
      repoFullName: string;
      type: 'checks';
    }
  | {
      actor?: ScmActor;
      installationId: string;
      kind: 'review_approved' | 'review_changes_requested' | 'review_commented';
      number: number;
      occurredAt?: Date;
      repoFullName: string;
      review: {
        body?: string | null;
        externalId: string;
        /** Inline comment location, when the review event is a single comment. */
        line?: number | null;
        path?: string | null;
        url?: string | null;
      };
      type: 'review';
    }
  | { reason: string; type: 'ignored' };

/** What the handler recorded on the delivery ledger and what it should tell the provider. */
export interface ScmIngestOutcome {
  /** Human-readable note for the delivery row (`skipped` reason, affected row id). */
  detail?: string;
  status: 'processed' | 'skipped';
}

export interface ScmDeliveryEnvelope {
  action?: string | null;
  deliveryId: string;
  event: string;
  provider: ScmProvider;
}
