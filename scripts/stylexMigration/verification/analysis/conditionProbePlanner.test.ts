import { describe, expect, it } from 'vitest';

import type { FixtureProbe } from '../pipeline/probePlanner';
import type { ConditionSeed } from './conditionProbePlanner';
import { planConditionProbes } from './conditionProbePlanner';
import { planRuleWitnesses } from './ruleWitnesses';

const makeSeed = (
  options: {
    conditions?: Array<{ kind: string; text: string }>;
    key?: string;
    selector?: string;
    side?: 'base' | 'candidate';
  } = {},
): ConditionSeed => {
  const plan = planRuleWitnesses(
    {
      gaps: [],
      rules: [
        {
          path: '0.0',
          kind: 'CSSStyleRule',
          selector: options.selector ?? '.row:hover',
          conditions: options.conditions ?? [],
          selectorAncestors: [],
          text: '',
        },
      ],
    },
    {
      bindings: [
        {
          kind: 'css-module',
          symbol: 'styles',
          slots: [{ name: 'row', start: 0, end: 1, unitId: 'unit' }],
        },
      ],
      gaps: [],
      source: 'file',
      sourceHash: 'hash',
      stylesheets: [],
    },
    { styles: { row: 'row' } },
  );
  const key = options.key ?? 'root.0.0';
  return {
    hostKey: 'root.0',
    legacyTriggerKey: key,
    side: options.side ?? 'base',
    plan,
    observation: {
      registeredProperties: [],
      viewportWidth: 1200,
      direction: 'ltr',
      observations: [
        {
          id: plan.rules[0].id,
          targets: [
            {
              key,
              active: false,
              conditionStates: plan.rules[0].conditions.map(() => true),
              containers: [{ key: 'root.0', name: 'card', type: 'inline-size', width: 320 }],
              content: undefined,
              display: undefined,
              triggers: [{ key, state: 'hover', tag: 'TR' }],
            },
          ],
        },
      ],
    },
  };
};
const probe: FixtureProbe = {
  direction: 'ltr',
  id: 'original',
  pseudo: 'default',
  variant: 'normal',
  width: 599,
};
const options = {
  hostDomain: [320, 920] as [number, number],
  viewportDomain: [320, 1200] as [number, number],
  probes: [probe],
  remaining: 256,
  variant: 'normal',
};

describe('source-bound condition partition planning', () => {
  it('unions B/M boundaries on the same target, reuses existing environments and preserves the declared matrix', () => {
    const probes = [probe, { ...probe, id: 'legacy-hover', pseudo: 'hover' as const }];
    const before = JSON.stringify(probes);
    const plan = planConditionProbes({
      ...options,
      probes,
      seeds: [
        makeSeed({ conditions: [{ kind: 'CSSContainerRule', text: '(max-width:600px)' }] }),
        makeSeed({
          side: 'candidate',
          conditions: [{ kind: 'CSSContainerRule', text: 'card (max-width:800px)' }],
        }),
      ],
    });
    expect(JSON.stringify(probes)).toBe(before);
    expect(plan.requirements.some((key) => key.width === 600)).toBe(true);
    expect(plan.requirements.some((key) => key.width === 800)).toBe(true);
    expect(
      plan.requirements.some(
        (key) => key.partition.host === '(320,600)' && key.probeId === 'legacy-hover',
      ),
    ).toBe(true);
    expect(plan.reused).toBeGreaterThan(0);
    expect(new Set(plan.requirements.map((key) => key.id)).size).toBe(plan.requirements.length);
    expect(plan.gateEligible).toBe(false);
  });
  it('does not cross unrelated media/container paths, but keeps their intersection on a shared target', () => {
    const media = makeSeed({ conditions: [{ kind: 'CSSMediaRule', text: '(max-width:700px)' }] });
    const container = makeSeed({
      key: 'root.0.1',
      conditions: [{ kind: 'CSSContainerRule', text: '(max-width:600px)' }],
    });
    const separate = planConditionProbes({ ...options, seeds: [media, container] });
    expect(
      separate.scheduled.some((probe) => probe.width !== 320 && probe.viewportWidth !== 1200),
    ).toBe(false);
    const together = planConditionProbes({
      ...options,
      seeds: [
        media,
        makeSeed({
          side: 'candidate',
          conditions: [{ kind: 'CSSContainerRule', text: '(max-width:600px)' }],
        }),
      ],
    });
    expect(
      together.scheduled.some((probe) => probe.width === 600 && probe.viewportWidth === 700),
    ).toBe(true);
  });
  it('never merges two DOM triggers just because they share a class', () => {
    const plan = planConditionProbes({
      ...options,
      seeds: [makeSeed(), makeSeed({ key: 'root.0.1' })],
    });
    expect(
      new Set(plan.scheduled.flatMap((probe) => (probe.interaction ? [probe.interaction.key] : [])))
        .size,
    ).toBe(2);
  });
  it('retains all required keys and overflow when the remaining probe budget is zero', () => {
    const plan = planConditionProbes({ ...options, seeds: [makeSeed()], remaining: 0 });
    expect(plan.scheduled).toHaveLength(0);
    expect(plan.overflow.length).toBeGreaterThan(0);
    expect(plan.requirements).toHaveLength(2);
    expect(plan.gaps).toContain('CONDITION_PROBE_BUDGET_EXCEEDED');
  });
  it('refuses unowned named containers and retains unsupported/unmounted branches', () => {
    const seed = makeSeed({
      conditions: [{ kind: 'CSSContainerRule', text: 'other (max-width:600px)' }],
    });
    expect(planConditionProbes({ ...options, seeds: [seed] }).gaps).toContain(
      'QUERY_CONTAINER_NOT_CONTROLLABLE',
    );
    const unmounted = { ...seed, observation: { ...seed.observation, observations: [] } };
    expect(planConditionProbes({ ...options, seeds: [unmounted] }).gaps).toContain(
      'CONDITION_TARGET_UNMOUNTED',
    );
    const unsupported = makeSeed({ selector: '.row:has(.child:hover)' });
    expect(planConditionProbes({ ...options, seeds: [unsupported] }).gaps).toContain(
      'CONDITION_RULE_OR_TRIGGER_UNSUPPORTED',
    );
  });
  it('retains unrepresentable fractional viewport boundaries instead of rounding them into coverage', () => {
    const plan = planConditionProbes({
      ...options,
      seeds: [makeSeed({ conditions: [{ kind: 'CSSMediaRule', text: '(width < 599.3px)' }] })],
    });
    expect(plan.gaps).toContain('VIEWPORT_PARTITION_UNREPRESENTABLE');
    expect(plan.scheduled.every((probe) => Number.isInteger(probe.viewportWidth))).toBe(true);
  });
  it('gives later rows and both directions a sample before expanding the first row across every width', () => {
    const plan = planConditionProbes({
      ...options,
      remaining: 10,
      seeds: Array.from({ length: 4 }, (_, index) =>
        makeSeed({
          key: `root.0.${index}`,
          conditions: [{ kind: 'CSSContainerRule', text: '(max-width:600px)' }],
        }),
      ),
    });
    const scheduled = plan.scheduled.filter((probe) => probe.interaction);
    expect(
      new Set(scheduled.map((probe) => `${probe.interaction!.key}:${probe.direction}`)).size,
    ).toBe(8);
    expect(plan.overflow.length).toBeGreaterThan(0);
    expect(new Set([...plan.scheduled, ...plan.overflow].map((probe) => probe.id)).size).toBe(
      plan.scheduled.length + plan.overflow.length,
    );
    expect(
      plan.requirements.every(
        (key) =>
          options.probes.some((probe) => probe.id === key.probeId) ||
          [...plan.scheduled, ...plan.overflow].some((probe) => probe.id === key.probeId),
      ),
    ).toBe(true);
  });
});
