interface AcceptanceProjectionCheck {
  id: string;
  supersededIds?: string[];
}

interface AcceptanceProjectionRound {
  run: {
    plan?: Array<{ id: string }> | null;
  };
}

/**
 * The Acceptance workspace owns a cross-round union, while Task detail represents
 * the current gate. Project the union back onto the latest plan so removed or
 * historical checks do not inflate the Task's count.
 */
export const resolveLatestTaskAcceptanceChecks = <T extends AcceptanceProjectionCheck>(
  checks: T[],
  rounds: AcceptanceProjectionRound[],
): T[] => {
  const latestPlan = rounds.at(-1)?.run.plan;
  if (!latestPlan) return checks;

  const latestIds = new Set(latestPlan.map((item) => item.id));
  return checks.filter(
    (check) =>
      latestIds.has(check.id) ||
      check.supersededIds?.some((supersededId) => latestIds.has(supersededId)),
  );
};

/** Task configuration is the source used to instantiate the next Acceptance round. */
export const resolveTaskAcceptanceRequirement = (
  configuredRequirement: string | null | undefined,
  aggregateRequirement: string | null | undefined,
) => configuredRequirement?.trim() || aggregateRequirement?.trim() || '';
