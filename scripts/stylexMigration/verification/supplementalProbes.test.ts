import { describe, expect, it } from 'vitest';

import type { FixtureProbe } from './probePlanner';
import type { RuleProbeEvidence } from './ruleCoverage';
import { planRuleWitnesses } from './ruleWitnesses';
import { planSupplementalProbes } from './supplementalProbes';

const plan = planRuleWitnesses(
  {
    gaps: [],
    rules: [
      {
        kind: 'CSSStyleRule',
        path: '0.0',
        selector: '.row:hover',
        selectorAncestors: [],
        conditions: [],
        text: '',
      },
    ],
  },
  {
    bindings: [
      {
        kind: 'css-module',
        symbol: 'styles',
        slots: [{ name: 'row', start: 0, end: 1, unitId: 'row' }],
      },
    ],
    gaps: [],
    source: 'file',
    sourceHash: 'hash',
    stylesheets: [],
  },
  { styles: { row: 'row' } },
);
const probe: FixtureProbe = {
  id: 'initial',
  variant: 'normal',
  pseudo: 'default',
  direction: 'ltr',
  width: 320,
};
const target = (key: string, active: boolean) => ({
  key,
  active,
  conditionStates: [],
  containers: [],
  content: undefined,
  display: undefined,
  triggers: [{ key, state: 'hover', tag: 'TR' }],
});
const evidence: RuleProbeEvidence = {
  probeId: probe.id,
  side: 'base',
  variant: 'normal',
  evidenceRefs: ['capture'],
  observation: {
    registeredProperties: [],
    viewportWidth: 1200,
    direction: 'ltr',
    observations: [{ id: '0.0:0', targets: [target('root.0', true), target('root.1', false)] }],
  },
};
const input = {
  plans: [{ plan, side: 'base' as const, variant: 'normal' }],
  evidence: [evidence],
  probes: [probe],
  remaining: 80,
};

describe('bounded activation-gap supplementation', () => {
  it('targets the untouched row instead of forcing every matching row together', () => {
    const result = planSupplementalProbes(input);
    expect(result.scheduled).toHaveLength(1);
    expect(result.scheduled[0].interaction).toEqual({ key: 'root.1', state: 'hover', tag: 'TR' });
    expect(result.requirements[0].key).toBe('root.1');
    expect(result.gateEligible).toBe(false);
  });
  it('deduplicates a paired B/M gap but never drops overflow requirements', () => {
    const result = planSupplementalProbes({
      ...input,
      plans: [...input.plans, { plan, side: 'candidate', variant: 'normal' }],
      evidence: [evidence, { ...evidence, side: 'candidate' }],
      remaining: 0,
    });
    expect(result.blocked).toHaveLength(1);
    expect(result.requirements).toHaveLength(2);
    expect(result.scheduled).toHaveLength(0);
    expect(result.gaps).toContain('SUPPLEMENTAL_PROBE_BUDGET_EXCEEDED');
  });
  it('does not invent operations for ambiguous or missing trigger bindings', () => {
    const result = planSupplementalProbes({
      ...input,
      evidence: [
        {
          ...evidence,
          observation: {
            registeredProperties: [],
            viewportWidth: 1200,
            direction: 'ltr',
            observations: [
              { id: '0.0:0', targets: [{ ...target('root.1', false), triggers: [] }] },
            ],
          },
        },
      ],
    });
    expect(result.scheduled).toHaveLength(0);
    expect(result.gaps).toContain('TRIGGER_BINDING_AMBIGUOUS_OR_MISSING');
    expect(result.requirements).toHaveLength(1);
  });
  it('does not schedule states where no observation has satisfied the condition', () => {
    const result = planSupplementalProbes({
      ...input,
      evidence: [
        {
          ...evidence,
          observation: {
            registeredProperties: [],
            viewportWidth: 1200,
            direction: 'ltr',
            observations: [
              { id: '0.0:0', targets: [{ ...target('root.1', false), conditionStates: [false] }] },
            ],
          },
        },
      ],
    });
    expect(result.scheduled).toHaveLength(0);
  });
});
