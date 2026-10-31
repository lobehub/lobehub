import { describe, expect, it } from 'vitest';

import { planRuleWitnesses } from './ruleWitnesses';
import type { StyleBindingPlan } from './styleBindings';

const plan: StyleBindingPlan = {
  bindings: [
    {
      kind: 'static-factory',
      symbol: 'styles',
      slots: [{ name: 'root', unitId: 'Component:style-slot:0', start: 0, end: 10 }],
    },
  ],
  gaps: [],
  source: 'Component.tsx',
  sourceHash: 'hash',
  stylesheets: [],
};
describe('compiled rule / source slot joins', () => {
  const rule = {
    conditions: [],
    selectorAncestors: [],
    kind: 'CSSStyleRule',
    path: '0.0',
    selector: '.compiled:hover',
    text: '.compiled:hover{color:red}',
  };
  it('retains rules even if no target was mounted and does not remove inactive conditions', () => {
    const result = planRuleWitnesses(
      {
        gaps: [],
        rules: [{ ...rule, conditions: [{ kind: 'CSSContainerRule', text: '(max-width:600px)' }] }],
      },
      plan,
      { styles: { root: 'compiled' } },
    );
    expect(result.rules[0]).toMatchObject({
      sourceSlots: ['styles.root'],
      sourceUnitIds: ['Component:style-slot:0'],
      conditions: [{ kind: 'CSSContainerRule', text: '(max-width:600px)' }],
    });
    expect(result.rules[0].targetSelector).toBe('.compiled');
  });
  it('does not attribute unrelated UI library classes to this component', () => {
    expect(
      planRuleWitnesses({ gaps: [], rules: [{ ...rule, selector: '.ui-library' }] }, plan, {
        styles: { root: 'compiled' },
      }).rules,
    ).toHaveLength(0);
  });
  it('traces replaced Emotion classes through nested compositions without claiming declaration ownership', () => {
    const result = planRuleWitnesses(
      { gaps: [], rules: [{ ...rule, selector: '.combined:hover' }] },
      plan,
      { styles: { root: 'original' } },
      {
        gaps: [],
        records: [
          { callId: 2, inputs: ['intermediate'], output: 'combined' },
          { callId: 1, inputs: ['original'], output: 'intermediate' },
        ],
      },
    );
    expect(result.rules[0].sourceSlots).toEqual(['styles.root']);
    expect(result.compositions.map((entry) => entry.className)).toContain('combined');
    expect(result.gaps).toContain('COMPOSITION_DECLARATION_OWNERSHIP_UNPROVEN');
  });
  it('does not assign all contributing slots to unchanged output tokens and retains unknown inputs', () => {
    const result = planRuleWitnesses(
      { gaps: [], rules: [{ ...rule, selector: '.external' }] },
      plan,
      { styles: { root: 'original' } },
      {
        gaps: [],
        records: [{ callId: 1, inputs: ['original', 'external'], output: 'original external' }],
      },
    );
    expect(result.rules).toHaveLength(0);
    expect(result.gaps).toContain('COMPOSITION_INPUT_SOURCE_UNPROVEN');
  });
  it('keeps missing exports, unsupported selectors and query syntax as explicit gaps', () => {
    expect(planRuleWitnesses({ gaps: [], rules: [rule] }, plan, {}).gaps).toContain(
      'SOURCE_SLOT_NOT_EXPORTED:styles.root',
    );
    const result = planRuleWitnesses(
      {
        gaps: [],
        rules: [
          {
            ...rule,
            selector: '.compiled:has(.child:hover)',
            conditions: [{ kind: 'CSSContainerRule', text: 'style(--x: red)' }],
          },
        ],
      },
      plan,
      { styles: { root: 'compiled' } },
    );
    expect(result.rules[0].gaps).toContain('NESTED_STATE_SELECTOR_UNSUPPORTED');
    expect(result.rules[0].gaps).toContain('WIDTH_CONDITION_UNSUPPORTED:style(--x: red)');
  });
});
