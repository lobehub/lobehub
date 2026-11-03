import type { RuleObservation, RuleWitnessPlan } from './ruleWitnesses';

export interface RuleProbeEvidence {
  evidenceRefs: string[];
  observation: RuleObservation;
  probeId: string;
  side: 'base' | 'candidate';
  variant: string;
}

/** Diagnostic activation coverage, never a substitute for all required gate keys. */
export const summarizeRuleCoverage = (
  plans: Array<{ plan: RuleWitnessPlan; side: 'base' | 'candidate'; variant: string }>,
  evidence: RuleProbeEvidence[],
) => {
  const rules = plans.flatMap(({ plan, side, variant }) =>
    plan.rules.map((rule) => {
      const samples = evidence
        .filter((item) => item.side === side && item.variant === variant)
        .flatMap((item) => {
          const observation = item.observation.observations.find((entry) => entry.id === rule.id);
          return (
            observation?.targets.map((target) => ({
              ...target,
              evidenceRefs: item.evidenceRefs,
              probeId: item.probeId,
            })) ?? []
          );
        });
      const targetKeys = [...new Set(samples.map((sample) => sample.key))].sort();
      const activeKeys = [
        ...new Set(samples.filter((sample) => sample.active).map((sample) => sample.key)),
      ].sort();
      const requiredActivationKeys = [
        ...new Set(
          samples
            .filter((sample) => sample.conditionStates.every((condition) => condition === true))
            .map((sample) => sample.key),
        ),
      ].sort();
      const missingActivationKeys = requiredActivationKeys.filter(
        (key) => !activeKeys.includes(key),
      );
      const inactiveKeys = [
        ...new Set(samples.filter((sample) => !sample.active).map((sample) => sample.key)),
      ].sort();
      const status = rule.gaps.length
        ? 'UNSUPPORTED'
        : !targetKeys.length
          ? 'UNMOUNTED'
          : missingActivationKeys.length
            ? 'PARTIAL_ACTIVATION'
            : !activeKeys.length
              ? 'INACTIVE_ONLY'
              : 'OBSERVED';
      return {
        ...rule,
        activeKeys,
        inactiveKeys,
        missingActivationKeys,
        sampleCount: samples.length,
        side,
        status,
        targetKeys,
        variant,
        // Bounded references are enough to locate full per-probe records.
        positiveEvidence: samples
          .filter((sample) => sample.active)
          .slice(0, 3)
          .map(({ key, probeId, evidenceRefs }) => ({ key, probeId, evidenceRefs })),
      };
    }),
  );
  const gaps = [...new Set(plans.flatMap(({ plan }) => plan.gaps))];
  const groups = new Map<string, typeof rules>();
  for (const rule of rules) {
    // Activation identity across style variants, not declaration equivalence.
    const key = JSON.stringify([rule.side, rule.selector, rule.conditions, rule.sourceSlots]);
    const group = groups.get(key) ?? [];
    group.push(rule);
    groups.set(key, group);
  }
  const globallyUnmounted = [...groups.values()]
    .filter((group) =>
      group.every((rule) => rule.status !== 'UNSUPPORTED' && !rule.targetKeys.length),
    )
    .map((group) => ({
      side: group[0].side,
      selector: group[0].selector,
      conditions: group[0].conditions,
      sourceSlots: group[0].sourceSlots,
      variants: group.map((rule) => rule.variant),
    }));
  return {
    gateEligible: false as const,
    gaps,
    mode: 'diagnostic-source-slot-cssom-activation' as const,
    rules,
    globallyUnmounted,
    schemaVersion: 1,
    summary: {
      compiledBranches: rules.length,
      uniqueActivationBranches: groups.size,
      globallyUnmounted: globallyUnmounted.length,
      inactiveOnly: rules.filter((rule) => rule.status === 'INACTIVE_ONLY').length,
      missingActivationTargets: rules.reduce(
        (sum, rule) => sum + rule.missingActivationKeys.length,
        0,
      ),
      observed: rules.filter((rule) => rule.status === 'OBSERVED').length,
      partialActivation: rules.filter((rule) => rule.status === 'PARTIAL_ACTIVATION').length,
      unmounted: rules.filter((rule) => rule.status === 'UNMOUNTED').length,
      unsupported: rules.filter((rule) => rule.status === 'UNSUPPORTED').length,
    },
    limitations: [
      'SOURCE_RULE_MAPPING_NOT_CERTIFIED',
      'FULL_CONDITION_PARTITION_KEYS_UNPROVEN',
      'COMPOSITION_TRACE_SCOPE_LIMITED',
    ],
  };
};
