import type { WidthCondition } from './conditionPartitions';
import { matchesWidth, partitionWidthCells } from './conditionPartitions';
import type { FixtureProbe } from './probePlanner';
import type { RuleObservation, RuleWitnessPlan } from './ruleWitnesses';

export interface ConditionSeed {
  hostKey: string;
  hostWritingMode?: string;
  legacyTriggerKey?: string;
  legacyTriggerKeys?: Record<string, string | undefined>;
  observation: RuleObservation;
  plan: RuleWitnessPlan;
  side: 'base' | 'candidate';
}
export interface ConditionRequirement {
  conditions: boolean[];
  containerKey?: string;
  containerQueries: Array<{ key: string; name?: string }>;
  direction: FixtureProbe['direction'];
  expectedActive: boolean;
  id: string;
  partition: { host: string; viewport: string };
  probeId: string;
  ruleId: string;
  side: 'base' | 'candidate';
  sourceUnitIds: string[];
  targetKey: string;
  viewportWidth: number;
  width: number;
}

/** Read only the controlled host and legacy trigger; no marker/DOM mutation. */
export const readConditionHostInPage = (selectors: {
  'hover'?: string;
  'focus-visible'?: string;
}) => {
  const root = document.querySelector('[data-case-root]');
  if (!root) throw new Error('CONDITION_ROOT_MISSING');
  const keys = new Map<Element, string>();
  const walk = (element: Element, key: string) => {
    keys.set(element, key);
    [...element.children]
      .filter((child) => !['LINK', 'META', 'SCRIPT', 'STYLE'].includes(child.tagName))
      .forEach((child, index) => walk(child, `${key}.${index}`));
  };
  walk(root, 'root');
  const host = document.querySelector('[data-component-mount]')?.firstElementChild;
  if (!host || !keys.has(host)) throw new Error('CONTROLLED_CONTAINER_MISSING');
  return {
    hostKey: keys.get(host)!,
    hostWritingMode: getComputedStyle(host).writingMode,
    legacyTriggerKeys: Object.fromEntries(
      Object.entries(selectors).map(([state, selector]) => [
        state,
        selector ? keys.get(document.querySelector(selector)!) : undefined,
      ]),
    ),
  };
};

/** Required keys are diagnostic, not certified source coverage. Preserve the
 * entire declared host matrix. Only identical environment + operation is reused. */
export const planConditionProbes = (options: {
  hostDomain: [number, number];
  probes: FixtureProbe[];
  remaining: number;
  seeds: ConditionSeed[];
  variant: string;
  viewportDomain: [number, number];
}) => {
  const entries = options.seeds.flatMap((seed) =>
    seed.plan.rules.flatMap((rule) => {
      const targets =
        seed.observation.observations.find((entry) => entry.id === rule.id)?.targets ?? [];
      return targets.map((target) => ({ seed, rule, target }));
    }),
  );
  const requirements: ConditionRequirement[] = [];
  const blocked: Array<{ reason: string; ruleId: string; side: string; targetKey?: string }> = [];
  const generated: FixtureProbe[] = [];
  const existing = options.probes.filter((probe) => probe.variant === options.variant);
  const candidates = [...existing];
  let reused = 0;
  for (const { seed, rule, target } of entries) {
    if (
      rule.gaps.length ||
      rule.states.length > 1 ||
      (rule.states.length === 1 && target.triggers.length !== 1)
    ) {
      blocked.push({
        reason: 'CONDITION_RULE_OR_TRIGGER_UNSUPPORTED',
        ruleId: rule.id,
        side: seed.side,
        targetKey: target.key,
      });
      continue;
    }
    // B/M rules affecting this same DOM binding contribute their conditions.
    // Ancestor/sibling/layout influence closure is still explicitly unproven.
    const related = entries.filter((entry) => entry.target.key === target.key);
    const hostConditions: WidthCondition[] = [];
    const viewportConditions: WidthCondition[] = [];
    let reason: string | undefined;
    for (const entry of related)
      for (const condition of entry.rule.conditionModels) {
        if (condition.kind === 'CSSSupportsRule') continue;
        if (!condition.width) {
          reason = 'CONDITION_WIDTH_GRAMMAR_UNSUPPORTED';
          continue;
        }
        if (condition.kind === 'CSSMediaRule') {
          if (condition.width.name) reason = 'MEDIA_TYPE_UNSUPPORTED';
          else viewportConditions.push(condition.width);
        } else if (condition.kind === 'CSSContainerRule') {
          if (entry.seed.hostWritingMode && entry.seed.hostWritingMode !== 'horizontal-tb')
            reason = 'QUERY_WRITING_MODE_UNSUPPORTED';
          const container = entry.target.containers.find(
            (candidate) =>
              !condition.width!.name ||
              candidate.name.split(/\s+/).includes(condition.width!.name!),
          );
          if (container?.key !== entry.seed.hostKey) reason = 'QUERY_CONTAINER_NOT_CONTROLLABLE';
          else if (container.metricsTrusted === false) reason = 'QUERY_CONTENT_METRICS_UNSUPPORTED';
          else hostConditions.push(condition.width);
        } else reason = 'CONDITION_KIND_UNSUPPORTED';
      }
    if (reason) {
      blocked.push({ reason, ruleId: rule.id, side: seed.side, targetKey: target.key });
      continue;
    }
    const hostCells = hostConditions.length
      ? partitionWidthCells(
          hostConditions,
          ...options.hostDomain,
          existing.map((probe) => probe.width),
        )
      : [{ id: 'independent', width: options.hostDomain[0] }];
    const viewportCells = viewportConditions.length
      ? partitionWidthCells(
          viewportConditions,
          ...options.viewportDomain,
          existing.map((probe) => probe.viewportWidth ?? 1200),
        )
      : [{ id: 'independent', width: 1200 }];
    if (requirements.length + hostCells.length * viewportCells.length * 2 > 12000) {
      blocked.push({
        reason: 'CONDITION_KEY_BUDGET_EXCEEDED',
        ruleId: rule.id,
        side: seed.side,
        targetKey: target.key,
      });
      continue;
    }
    for (const direction of ['ltr', 'rtl'] as const)
      for (const host of hostCells)
        for (const viewport of viewportCells) {
          if (!Number.isInteger(viewport.width)) {
            blocked.push({
              reason: 'VIEWPORT_PARTITION_UNREPRESENTABLE',
              ruleId: rule.id,
              side: seed.side,
              targetKey: target.key,
            });
            continue;
          }
          const conditions = rule.conditionModels.map((condition, index) =>
            condition.kind === 'CSSSupportsRule'
              ? target.conditionStates[index]
              : matchesWidth(
                  condition.width!,
                  condition.kind === 'CSSMediaRule' ? viewport.width : host.width,
                ),
          );
          if (conditions.some((state) => state === null || state === undefined)) {
            blocked.push({
              reason: 'CONDITION_TRUTH_UNRESOLVED',
              ruleId: rule.id,
              side: seed.side,
              targetKey: target.key,
            });
            continue;
          }
          const expectedActive = conditions.every(Boolean);
          const interaction = expectedActive && rule.states.length ? target.triggers[0] : undefined;
          const match = candidates.find(
            (probe) =>
              probe.direction === direction &&
              probe.width === host.width &&
              (probe.viewportWidth ?? 1200) === viewport.width &&
              (interaction
                ? (probe.interaction?.key === interaction.key &&
                    probe.interaction.state === interaction.state) ||
                  (!probe.interaction &&
                    probe.pseudo === interaction.state &&
                    (seed.legacyTriggerKeys?.[interaction.state] ?? seed.legacyTriggerKey) ===
                      interaction.key)
                : !probe.interaction && probe.pseudo === 'default'),
          );
          let probe = match;
          if (probe) reused++;
          else {
            probe = {
              direction,
              id: `condition:${options.variant}:${direction}:${host.width}:${viewport.width}:${interaction?.key ?? 'default'}:${interaction?.state ?? 'default'}`,
              interaction,
              pseudo: 'default',
              variant: options.variant,
              viewportWidth: viewport.width,
              width: host.width,
            };
            generated.push(probe);
            candidates.push(probe);
          }
          requirements.push({
            conditions: conditions as boolean[],
            containerKey: hostConditions.length ? seed.hostKey : undefined,
            containerQueries: rule.conditionModels
              .filter((condition) => condition.kind === 'CSSContainerRule')
              .map((condition) => ({ key: seed.hostKey, name: condition.width?.name })),
            direction,
            expectedActive,
            id: JSON.stringify([
              seed.side,
              options.variant,
              rule.id,
              target.key,
              direction,
              host.id,
              viewport.id,
              interaction?.state ?? 'default',
            ]),
            partition: { host: host.id, viewport: viewport.id },
            probeId: probe.id,
            ruleId: rule.id,
            side: seed.side,
            sourceUnitIds: rule.sourceUnitIds,
            targetKey: target.key,
            viewportWidth: viewport.width,
            width: host.width,
          });
        }
  }
  for (const seed of options.seeds)
    for (const rule of seed.plan.rules)
      if (!entries.some((entry) => entry.seed === seed && entry.rule === rule))
        blocked.push({
          reason: rule.gaps.length
            ? 'CONDITION_RULE_OR_TRIGGER_UNSUPPORTED'
            : 'CONDITION_TARGET_UNMOUNTED',
          ruleId: rule.id,
          side: seed.side,
        });
  // Do not spend the remaining budget on every width of the first row while
  // later rows get no state sample at all. This only orders work; every unmet
  // key and every overflow probe remains in the report.
  const groups = new Map<string, FixtureProbe[]>();
  for (const probe of generated) {
    const key = JSON.stringify([probe.interaction?.key, probe.interaction?.state, probe.direction]);
    const group = groups.get(key) ?? [];
    group.push(probe);
    groups.set(key, group);
  }
  const ordered: FixtureProbe[] = [];
  for (let index = 0; ordered.length < generated.length; index++)
    for (const group of groups.values()) if (group[index]) ordered.push(group[index]);
  const scheduled = ordered.slice(0, Math.max(0, options.remaining));
  return {
    blocked,
    gateEligible: false as const,
    gaps: [
      ...new Set([
        ...blocked.map((entry) => entry.reason),
        ...(generated.length > scheduled.length ? ['CONDITION_PROBE_BUDGET_EXCEEDED'] : []),
      ]),
    ],
    mode: 'same-target-condition-partitions' as const,
    overflow: ordered.slice(scheduled.length),
    scheduling: 'round-robin-trigger-state-direction' as const,
    requirements,
    reused,
    scheduled,
    variant: options.variant,
    limitations: [
      'CONDITION_INFLUENCE_CLOSURE_UNPROVEN',
      'FLUID_LAYOUT_EQUIVALENCE_UNPROVEN',
      'SOURCE_RULE_MAPPING_NOT_CERTIFIED',
    ],
  };
};
export type ConditionProbePlan = ReturnType<typeof planConditionProbes>;
