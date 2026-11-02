import type { GoalArtifactView } from './goalGraphViewModel';
import type { CriterionLike, CriterionOutcome, EvidenceLike } from './goalResultState';

/**
 * The 结果交付 page's deliverables area, as data: every artifact the Goal
 * persisted, once, with who produced it and which acceptance criteria cite it
 * as evidence. The main deliverable leads; the rest follow newest first.
 *
 * Kept pure so the grouping, filtering and citation rules are testable apart
 * from the list and the reader that render them.
 */

export type DeliverableType = GoalArtifactView['type'];

export interface DeliverableItem {
  artifact: GoalArtifactView;
  /** Criteria whose latest-round evidence points at this artifact. */
  citedBy: CriterionLike[];
  primary: boolean;
  producerTitle?: string;
}

export interface DeliverableGroup {
  items: DeliverableItem[];
  /** The producing task node; `undefined` for the merged 其他任务 group. */
  nodeId?: string;
  title?: string;
}

/** From how many non-primary deliverables the list offers grouping, filters and search. */
export const MANY_DELIVERABLES = 6;

const RELATION_RANK: Record<string, number> = { produced: 0 };

/**
 * One row per Work. Two things used to arrive here as several rows for one
 * deliverable:
 *
 * - A version is linked to every node that touched it — the task that
 *   `produced` it and each task that took it as `input` — and a goal-level list
 *   must name it once, under the task that made it.
 * - A Work several runs revised gets a new version per claim, and every node
 *   that revised it declared that version as its own delivery. A shared backlog
 *   document therefore listed once per task (17 rows for 5 deliverables in the
 *   case that surfaced this). The deliverable is the same one: the row belongs
 *   to whoever delivered it first, which is the rule the coordinator now writes
 *   with too.
 *
 * So the surviving row is the best claim on the Work — `produced` beats a mere
 * `input` — and the earliest of those, so the list names the producer rather
 * than the last task that happened to touch it.
 */
export const dedupeArtifacts = (artifacts: GoalArtifactView[]): GoalArtifactView[] => {
  const rankOf = (artifact: GoalArtifactView) => RELATION_RANK[artifact.relation ?? ''] ?? 1;
  const byWork = new Map<string, GoalArtifactView>();
  for (const artifact of artifacts) {
    const seen = byWork.get(artifact.workId);
    if (!seen) {
      byWork.set(artifact.workId, artifact);
      continue;
    }
    // Same version, or a later claim on the same Work: keep the one that owns
    // the delivery — an explicit `produced`, and the earliest of those.
    const better =
      rankOf(artifact) < rankOf(seen) ||
      (rankOf(artifact) === rankOf(seen) && artifact.createdAt < seen.createdAt);
    if (better) byWork.set(artifact.workId, artifact);
  }
  return [...byWork.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
};

/**
 * Whether one piece of acceptance evidence points at the artifact: a cited
 * document by id, an uploaded file by file-store id or url, and anything with a
 * url by that url appearing in written evidence.
 */
export const evidenceCites = (artifact: GoalArtifactView, evidence: EvidenceLike): boolean => {
  if (artifact.type === 'document' && artifact.resourceId && evidence.documentId)
    return evidence.documentId === artifact.resourceId;
  if (artifact.fileId && evidence.fileId === artifact.fileId) return true;
  if (!artifact.url) return false;
  return evidence.fileUrl === artifact.url || !!evidence.content?.includes(artifact.url);
};

export const buildDeliverables = ({
  artifacts,
  outcomes,
  primaryResourceId,
  titleOf,
}: {
  artifacts: GoalArtifactView[];
  outcomes: CriterionOutcome[];
  /** The main deliverable's document id — see `pickFinalDeliverable`. */
  primaryResourceId?: string;
  titleOf: (nodeId: string) => string | undefined;
}): DeliverableItem[] => {
  const items = dedupeArtifacts(artifacts).map((artifact) => ({
    artifact,
    citedBy: outcomes
      .filter((outcome) => outcome.evidence.some((item) => evidenceCites(artifact, item)))
      .map((outcome) => outcome.criterion),
    primary:
      !!primaryResourceId &&
      artifact.type === 'document' &&
      artifact.resourceId === primaryResourceId,
    producerTitle: titleOf(artifact.nodeId),
  }));

  // The same document can carry several versions; only the newest is primary.
  const primaryIndex = items.findIndex((item) => item.primary);
  return [
    ...(primaryIndex >= 0 ? [items[primaryIndex]] : []),
    ...items
      .filter((_, index) => index !== primaryIndex)
      .map((item) => (item.primary ? { ...item, primary: false } : item)),
  ];
};

export const deliverableTypeCounts = (items: DeliverableItem[]) => {
  const counts = new Map<DeliverableType, number>();
  for (const { artifact } of items) counts.set(artifact.type, (counts.get(artifact.type) ?? 0) + 1);
  return counts;
};

export const filterDeliverables = (
  items: DeliverableItem[],
  { query, type }: { query: string; type: DeliverableType | 'all' },
): DeliverableItem[] => {
  const needle = query.trim().toLowerCase();
  return items.filter(({ artifact, producerTitle }) => {
    if (type !== 'all' && artifact.type !== type) return false;
    if (!needle) return true;
    return [artifact.title, artifact.identifier, producerTitle].some((text) =>
      text?.toLowerCase().includes(needle),
    );
  });
};

/**
 * Groups by the producing task, newest group first. A task that produced a
 * single deliverable gets no group of its own — a column of one-row groups is
 * noise, not structure — so those rows share one trailing 其他任务 group. When
 * nothing is left to separate (a single group), the list stays flat.
 */
export const groupDeliverables = (items: DeliverableItem[]): DeliverableGroup[] => {
  const byNode = new Map<string, DeliverableItem[]>();
  for (const item of items)
    byNode.set(item.artifact.nodeId, [...(byNode.get(item.artifact.nodeId) ?? []), item]);

  const groups: DeliverableGroup[] = [];
  const rest: DeliverableItem[] = [];
  for (const [nodeId, members] of byNode) {
    if (members.length < 2) {
      rest.push(...members);
      continue;
    }
    groups.push({ items: members, nodeId, title: members[0].producerTitle });
  }
  if (rest.length > 0) groups.push({ items: rest });

  return groups.length > 1 ? groups : [{ items }];
};
