import type { FixtureProbe } from './probePlanner';
import type { RuleProbeEvidence } from './ruleCoverage';
import { summarizeRuleCoverage } from './ruleCoverage';
import type { RuleWitnessPlan } from './ruleWitnesses';

/** Minimum activation-gap probes, NOT full condition/state partition coverage. */
export const planSupplementalProbes = (options: {
  evidence: RuleProbeEvidence[];
  plans: Array<{ plan: RuleWitnessPlan; side: 'base' | 'candidate'; variant: string }>;
  probes: FixtureProbe[];
  remaining: number;
}) => {
  const coverage = summarizeRuleCoverage(options.plans, options.evidence);
  const probes = new Map<string, FixtureProbe>();
  const requirements: Array<{
    key: string;
    evidenceRefs?: string[];
    probeId?: string;
    sourceProbeId?: string;
    reason?: string;
    ruleId: string;
    side: string;
    variant: string;
  }> = [];
  for (const rule of coverage.rules) {
    if (rule.gaps.length) continue;
    for (const key of rule.missingActivationKeys) {
      const requirement = { key, ruleId: rule.id, side: rule.side, variant: rule.variant };
      if (rule.states.length !== 1) {
        requirements.push({
          ...requirement,
          reason: 'MULTI_STATE_OR_NON_INTERACTION_GAP_UNPLANNED',
        });
        continue;
      }
      const sample = options.evidence
        .filter((entry) => entry.side === rule.side && entry.variant === rule.variant)
        .flatMap((entry) =>
          (entry.observation.observations.find((item) => item.id === rule.id)?.targets ?? [])
            .filter(
              (target) =>
                target.key === key && target.conditionStates.every((state) => state === true),
            )
            .map((target) => ({ entry, target })),
        )
        .find(({ target }) => target.triggers?.length === 1);
      const contract = options.probes.find((probe) => probe.id === sample?.entry.probeId);
      if (!sample || !contract) {
        requirements.push({ ...requirement, reason: 'TRIGGER_BINDING_AMBIGUOUS_OR_MISSING' });
        continue;
      }
      const interaction = sample.target.triggers![0];
      const id = `supplement:${contract.variant}:${contract.direction}:${contract.width}:${interaction.key}:${interaction.state}`;
      probes.set(id, { ...contract, id, interaction, pseudo: 'default' });
      requirements.push({
        ...requirement,
        probeId: id,
        sourceProbeId: sample.entry.probeId,
        evidenceRefs: sample.entry.evidenceRefs,
      });
    }
  }
  const planned = [...probes.values()];
  const scheduled = planned.slice(0, Math.max(0, options.remaining));
  return {
    coverageBefore: coverage.summary,
    gaps: [
      ...new Set([
        ...requirements.flatMap((entry) => (entry.reason ? [entry.reason] : [])),
        ...(planned.length > scheduled.length ? ['SUPPLEMENTAL_PROBE_BUDGET_EXCEEDED'] : []),
      ]),
    ],
    mode: 'minimum-target-activation-gap' as const,
    requirements,
    scheduled,
    blocked: planned.slice(scheduled.length),
    gateEligible: false as const,
  };
};
