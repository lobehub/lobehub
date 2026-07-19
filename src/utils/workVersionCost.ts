export const formatWorkVersionCost = (cost?: number | null): string | null => {
  if (!cost || cost <= 0) return null;

  if (cost < 0.01) return `$${cost.toFixed(4)}`;

  return `$${cost.toFixed(2)}`;
};

interface VersionCostInput {
  cumulativeCost: number | null;
  id: string;
  rootOperationId: string | null;
  version: number;
}

/**
 * Derive each version's own spend from `cumulativeCost`, which is a running
 * snapshot of the whole operation's spend at write time — NOT a per-version
 * delta (see `packages/database/src/models/work/cost.ts`). Within one root
 * operation, a version's cost is its cumulative minus the previous version's
 * cumulative; the operation's first version keeps the full snapshot. Versions
 * without a rootOperationId are independent operations. Summing the returned
 * deltas therefore matches the Work's total cost shown on the summary card.
 */
export const computeWorkVersionCostDeltas = (
  versions: VersionCostInput[],
): Map<string, number | null> => {
  const sorted = [...versions].sort((a, b) => a.version - b.version);
  const deltas = new Map<string, number | null>();
  const lastCumulativeByOperation = new Map<string, number>();

  for (const version of sorted) {
    if (version.cumulativeCost === null) {
      deltas.set(version.id, null);
      continue;
    }
    if (!version.rootOperationId) {
      deltas.set(version.id, version.cumulativeCost);
      continue;
    }
    const previous = lastCumulativeByOperation.get(version.rootOperationId);
    // Cumulative snapshots are non-decreasing within an operation; clamp
    // defensively so a bad row never renders a negative cost.
    deltas.set(
      version.id,
      previous === undefined
        ? version.cumulativeCost
        : Math.max(0, version.cumulativeCost - previous),
    );
    lastCumulativeByOperation.set(version.rootOperationId, version.cumulativeCost);
  }

  return deltas;
};
