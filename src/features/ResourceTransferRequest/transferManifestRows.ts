import type { TransferManifest } from '@/services/resourceTransferRequest';

/**
 * How a row's subject survives the handover. The renderer turns this into an
 * icon, which is what makes up to nine prose lines scannable: the reader sees
 * whether the agent arrives with something switched off, disconnected, or
 * unbound before reading a single sentence. `blocker` is not an impact but a
 * refusal — the recipient cannot accept at all — so it leads the list.
 */
export type ManifestImpact = 'blocker' | 'carried' | 'reset' | 'detached';

export type TransferManifestPerspective = 'initiator' | 'recipient';

export interface TransferManifestRow {
  /** Stable per-field id, used as the render key. */
  id: string;
  impact: ManifestImpact;
  /** i18n key for the caller's perspective. */
  key: string;
  /** Interpolation values for that key. */
  options: Record<string, unknown>;
}

interface ManifestRowSpec {
  /** Interpolation values when the row applies to this manifest, `null` when it does not. */
  applies: (manifest: TransferManifest) => Record<string, unknown> | null;
  impact: Exclude<ManifestImpact, 'blocker'>;
  initiatorKey: string;
  /**
   * Omitted for rows the recipient has no stake in. Three counts are computed
   * by EXCLUDING the recipient (`<> recipientId`) — other members' task
   * assignments, and groups/projects owned by someone else — so they answer
   * the sender's question ("does this break a colleague's work?") and never
   * the receiver's ("what am I taking on?"). Showing them on the incoming card
   * spends the reader's attention on other people's resources, which they
   * neither own after the handover nor can act on before it.
   */
  recipientKey?: string;
}

/**
 * The manifest fields that render as their own row: everything except the
 * display-only extras and the blocking flag, which leads the list separately.
 */
type ManifestRowField = Exclude<
  keyof TransferManifest,
  'botPlatforms' | 'hiddenReferencedMember' | 'ownerId'
>;

/**
 * Keyed by manifest field and checked against it, so a field added to the
 * summary without a row here fails to compile instead of silently going
 * unmentioned — the summary grew from six fields to nine during development,
 * with two call sites to keep in sync by hand.
 *
 * Declaration order is render order: carried, then reset, then detached, so the
 * icon column reads as runs instead of alternating and the irreversible losses
 * land last, where the eye stops.
 */
const MANIFEST_ROWS: Record<ManifestRowField, ManifestRowSpec> = {
  botBindings: {
    applies: (m) =>
      m.botBindings > 0 ? { count: m.botBindings, platforms: m.botPlatforms.join(', ') } : null,
    impact: 'carried',
    initiatorKey: 'transferRequest.manifestInitiator.bots',
    recipientKey: 'transferRequest.manifest.bots',
  },
  cronJobs: {
    applies: (m) => (m.cronJobs > 0 ? { count: m.cronJobs } : null),
    impact: 'carried',
    initiatorKey: 'transferRequest.manifestInitiator.cronJobs',
    recipientKey: 'transferRequest.manifest.cronJobs',
  },
  deviceBindingAffected: {
    applies: (m) => (m.deviceBindingAffected ? {} : null),
    impact: 'reset',
    initiatorKey: 'transferRequest.manifestInitiator.deviceReset',
    recipientKey: 'transferRequest.manifest.deviceReset',
  },
  connectorsAffected: {
    applies: (m) => (m.connectorsAffected > 0 ? { count: m.connectorsAffected } : null),
    impact: 'reset',
    initiatorKey: 'transferRequest.manifestInitiator.connectorsReset',
    recipientKey: 'transferRequest.manifest.connectorsReset',
  },
  tasksToDetach: {
    applies: (m) => (m.tasksToDetach > 0 ? { count: m.tasksToDetach } : null),
    impact: 'detached',
    initiatorKey: 'transferRequest.manifestInitiator.tasksDetach',
  },
  groupsToLeave: {
    applies: (m) => (m.groupsToLeave > 0 ? { count: m.groupsToLeave } : null),
    impact: 'detached',
    initiatorKey: 'transferRequest.manifestInitiator.groupsLeave',
  },
  projectsToLeave: {
    applies: (m) => (m.projectsToLeave > 0 ? { count: m.projectsToLeave } : null),
    impact: 'detached',
    initiatorKey: 'transferRequest.manifestInitiator.projectsLeave',
  },
  knowledgeToDetach: {
    applies: (m) => (m.knowledgeToDetach > 0 ? { count: m.knowledgeToDetach } : null),
    impact: 'detached',
    initiatorKey: 'transferRequest.manifestInitiator.knowledgeDetach',
    recipientKey: 'transferRequest.manifest.knowledgeDetach',
  },
  expertiseAffected: {
    applies: (m) => (m.expertiseAffected > 0 ? { count: m.expertiseAffected } : null),
    impact: 'detached',
    initiatorKey: 'transferRequest.manifestInitiator.expertiseAdjust',
    recipientKey: 'transferRequest.manifest.expertiseAdjust',
  },
};

/**
 * The rows a manifest actually produces, in render order, for one party's
 * perspective. Empty means the handover carries nothing beyond the resource
 * itself — the caller renders nothing rather than an empty panel.
 */
export const buildTransferManifestRows = (
  manifest: TransferManifest,
  perspective: TransferManifestPerspective,
): TransferManifestRow[] => {
  const isInitiator = perspective === 'initiator';
  const rows: TransferManifestRow[] = [];

  if (manifest.hiddenReferencedMember)
    rows.push({
      id: 'hiddenReferencedMember',
      impact: 'blocker',
      key: isInitiator
        ? 'transferRequest.manifestInitiator.hiddenMember'
        : 'transferRequest.manifest.hiddenMember',
      options: {},
    });

  for (const [field, spec] of Object.entries(MANIFEST_ROWS)) {
    // No key for this perspective means the row is not this party's business
    // (see `recipientKey`), so it is dropped rather than reworded.
    const key = isInitiator ? spec.initiatorKey : spec.recipientKey;
    if (!key) continue;
    const options = spec.applies(manifest);
    if (!options) continue;
    rows.push({ id: field, impact: spec.impact, key, options });
  }

  return rows;
};
