import { expect, it } from 'vitest';

import { summarizeRuleCoverage } from './ruleCoverage';
import { planRuleWitnesses } from './ruleWitnesses';

it('reports an untouched second interaction target instead of closing the rule after one hit', () => {
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
          symbol: 'styles',
          kind: 'static-factory',
          slots: [{ name: 'row', unitId: 'unit', start: 0, end: 1 }],
        },
      ],
      gaps: [],
      source: 'file',
      sourceHash: 'hash',
      stylesheets: [],
    },
    { styles: { row: 'row' } },
  );
  const result = summarizeRuleCoverage(
    [{ plan, side: 'base', variant: 'normal' }],
    [
      {
        evidenceRefs: ['snapshot.json.gz'],
        probeId: 'hover-first',
        side: 'base',
        variant: 'normal',
        observation: {
          registeredProperties: [],
          viewportWidth: 1200,
          direction: 'ltr',
          observations: [
            {
              id: '0.0:0',
              targets: [
                {
                  active: true,
                  conditionStates: [],
                  triggers: [],
                  containers: [],
                  key: 'root.0',
                  content: undefined,
                  display: undefined,
                },
                {
                  active: false,
                  conditionStates: [],
                  triggers: [],
                  containers: [],
                  key: 'root.1',
                  content: undefined,
                  display: undefined,
                },
              ],
            },
          ],
        },
      },
    ],
  );
  expect(result.rules[0].status).toBe('PARTIAL_ACTIVATION');
  expect(result.rules[0].missingActivationKeys).toEqual(['root.1']);
  expect(result.gateEligible).toBe(false);
});

it('keeps unmounted source branches in the denominator', () => {
  const plan = planRuleWitnesses(
    {
      gaps: [],
      rules: [
        {
          kind: 'CSSStyleRule',
          path: '0.0',
          selector: '.unused',
          selectorAncestors: [],
          conditions: [],
          text: '',
        },
      ],
    },
    {
      bindings: [
        {
          symbol: 'styles',
          kind: 'static-factory',
          slots: [{ name: 'unused', unitId: 'unit', start: 0, end: 1 }],
        },
      ],
      gaps: [],
      source: 'file',
      sourceHash: 'hash',
      stylesheets: [],
    },
    { styles: { unused: 'unused' } },
  );
  expect(
    summarizeRuleCoverage([{ plan, side: 'candidate', variant: 'normal' }], []).summary.unmounted,
  ).toBe(1);
});

it('does not treat an intentional empty variant as globally missing when another variant mounts the rule', () => {
  const plan = planRuleWitnesses(
    {
      gaps: [],
      rules: [
        {
          kind: 'CSSStyleRule',
          path: '0.0',
          selector: '.row',
          selectorAncestors: [],
          conditions: [],
          text: '',
        },
      ],
    },
    {
      bindings: [
        {
          symbol: 'styles',
          kind: 'static-factory',
          slots: [{ name: 'row', unitId: 'unit', start: 0, end: 1 }],
        },
      ],
      gaps: [],
      source: 'file',
      sourceHash: 'hash',
      stylesheets: [],
    },
    { styles: { row: 'row' } },
  );
  const result = summarizeRuleCoverage(
    [
      { plan, side: 'base', variant: 'normal' },
      { plan, side: 'base', variant: 'empty' },
    ],
    [
      {
        evidenceRefs: ['snapshot.json.gz'],
        probeId: 'default',
        side: 'base',
        variant: 'normal',
        observation: {
          registeredProperties: [],
          viewportWidth: 1200,
          direction: 'ltr',
          observations: [
            {
              id: '0.0:0',
              targets: [
                {
                  active: true,
                  conditionStates: [],
                  triggers: [],
                  containers: [],
                  key: 'root.0',
                  content: undefined,
                  display: undefined,
                },
              ],
            },
          ],
        },
      },
    ],
  );
  expect(result.summary.unmounted).toBe(1);
  expect(result.summary.globallyUnmounted).toBe(0);
  expect(result.summary.uniqueActivationBranches).toBe(1);
});
