import type { ConditionProbePlan } from './conditionProbePlanner';
import type { RuleProbeEvidence } from './ruleCoverage';

const matchesCell = (id: string, width: number, planned: number) => {
  if (!Number.isFinite(width)) return false;
  if (id === 'independent') return Math.abs(width - planned) < 1e-7;
  if (id.startsWith('[')) return Math.abs(width - Number(id.slice(1, -1))) < 1e-7;
  const [lower, upper] = id.slice(1, -1).split(',').map(Number);
  return width > lower && width < upper;
};

/** Per side/rule/node/partition/direction/operation records, still not certified
 * gate witnesses. In particular a rule hit in one cell cannot close another. */
export const summarizeConditionCoverage = (
  plans: ConditionProbePlan[],
  evidence: RuleProbeEvidence[],
  stableProbeIds: string[],
) => {
  const stable = new Set(stableProbeIds);
  const keys = plans.flatMap((plan) =>
    plan.requirements.map((required) => {
      const sample = evidence.find(
        (entry) =>
          entry.probeId === required.probeId &&
          entry.side === required.side &&
          entry.variant === plan.variant,
      );
      const target = sample?.observation.observations
        .find((entry) => entry.id === required.ruleId)
        ?.targets.find((entry) => entry.key === required.targetKey);
      const container = target?.containers.find((entry) => entry.key === required.containerKey);
      const status =
        !sample || !sample.evidenceRefs.length
          ? 'MISSING_PROBE'
          : !stable.has(required.probeId)
            ? 'PROBE_UNSTABLE'
            : !target
              ? 'TARGET_UNMOUNTED'
              : sample.observation.direction !== required.direction ||
                  required.containerQueries.some(
                    (query) =>
                      target.containers.find(
                        (entry) => !query.name || entry.name.split(/\s+/).includes(query.name),
                      )?.key !== query.key ||
                      target.containers.find(
                        (entry) => !query.name || entry.name.split(/\s+/).includes(query.name),
                      )?.metricsTrusted === false,
                  ) ||
                  !matchesCell(
                    required.partition.viewport,
                    sample.observation.viewportWidth,
                    required.viewportWidth,
                  ) ||
                  (required.containerKey &&
                    (!container ||
                      container.metricsTrusted === false ||
                      !matchesCell(required.partition.host, container.width, required.width)))
                ? 'ENVIRONMENT_MISMATCH'
                : JSON.stringify(target.conditionStates) !== JSON.stringify(required.conditions)
                  ? 'CONDITION_TRUTH_MISMATCH'
                  : target.active !== required.expectedActive
                    ? 'ACTIVATION_MISMATCH'
                    : 'OBSERVED';
      return {
        ...required,
        status,
        variant: plan.variant,
        evidenceRefs: sample?.evidenceRefs ?? [],
        actual: target
          ? {
              active: target.active,
              conditions: target.conditionStates,
              containerWidth: container?.width,
              viewportWidth: sample?.observation.viewportWidth,
              direction: sample?.observation.direction,
            }
          : undefined,
      };
    }),
  );
  return {
    gateEligible: false as const,
    keys,
    limitations: [...new Set(plans.flatMap((plan) => plan.limitations))],
    summary: {
      required: keys.length,
      observed: keys.filter((entry) => entry.status === 'OBSERVED').length,
      missing: keys.filter((entry) => entry.status !== 'OBSERVED').length,
      blockedBindings: plans.reduce((sum, plan) => sum + plan.blocked.length, 0),
      scheduledProbes: plans.reduce((sum, plan) => sum + plan.scheduled.length, 0),
      overflowProbes: plans.reduce((sum, plan) => sum + plan.overflow.length, 0),
      reusedRequirements: plans.reduce((sum, plan) => sum + plan.reused, 0),
    },
  };
};
