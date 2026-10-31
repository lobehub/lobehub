import { describe, expect, it } from 'vitest';

import { summarizeConditionCoverage } from './conditionCoverage';
import type { ConditionProbePlan, ConditionRequirement } from './conditionProbePlanner';
import type { RuleProbeEvidence } from './ruleCoverage';

const required: ConditionRequirement = {
  conditions: [true],
  containerKey: 'root.0',
  containerQueries: [{ key: 'root.0', name: 'card' }],
  direction: 'ltr',
  expectedActive: true,
  id: 'key',
  partition: { host: '[600]', viewport: 'independent' },
  probeId: 'probe',
  ruleId: 'rule',
  side: 'base',
  sourceUnitIds: ['unit'],
  targetKey: 'root.0.1',
  viewportWidth: 1200,
  width: 600,
};
const plan: ConditionProbePlan = {
  blocked: [],
  gateEligible: false,
  gaps: [],
  mode: 'same-target-condition-partitions',
  scheduling: 'round-robin-trigger-state-direction',
  overflow: [],
  requirements: [required],
  reused: 1,
  scheduled: [],
  variant: 'normal',
  limitations: ['CONDITION_INFLUENCE_CLOSURE_UNPROVEN'],
};
const sample: RuleProbeEvidence = {
  evidenceRefs: ['snapshot'],
  probeId: 'probe',
  side: 'base',
  variant: 'normal',
  observation: {
    registeredProperties: [],
    viewportWidth: 1200,
    direction: 'ltr',
    observations: [
      {
        id: 'rule',
        targets: [
          {
            key: 'root.0.1',
            active: true,
            conditionStates: [true],
            containers: [{ key: 'root.0', name: 'card', type: 'inline-size', width: 600 }],
            content: undefined,
            display: undefined,
            triggers: [],
          },
        ],
      },
    ],
  },
};

describe('condition keys use measured per-node evidence', () => {
  it('accepts only the actual matching stable probe and leaves another partition missing', () => {
    const result = summarizeConditionCoverage(
      [
        {
          ...plan,
          requirements: [
            required,
            {
              ...required,
              id: 'other',
              probeId: 'missing',
              partition: { ...required.partition, host: '(600,920)' },
            },
          ],
        },
      ],
      [sample],
      ['probe'],
    );
    expect(result.keys.map((key) => key.status)).toEqual(['OBSERVED', 'MISSING_PROBE']);
    expect(result.summary.missing).toBe(1);
    expect(result.gateEligible).toBe(false);
  });
  it('does not use an unstable A/A capture or an evidence-free record', () => {
    expect(summarizeConditionCoverage([plan], [sample], []).keys[0].status).toBe('PROBE_UNSTABLE');
    expect(
      summarizeConditionCoverage([plan], [{ ...sample, evidenceRefs: [] }], ['probe']).keys[0]
        .status,
    ).toBe('MISSING_PROBE');
  });
  it('checks the real query content width, viewport and predicate rather than the requested width', () => {
    const changed = structuredClone(sample);
    changed.observation.observations[0].targets[0].containers[0].width = 599.999;
    expect(summarizeConditionCoverage([plan], [changed], ['probe']).keys[0].status).toBe(
      'ENVIRONMENT_MISMATCH',
    );
    changed.observation.observations[0].targets[0].containers[0].width = 600;
    changed.observation.viewportWidth = 1201;
    expect(summarizeConditionCoverage([plan], [changed], ['probe']).keys[0].status).toBe(
      'ENVIRONMENT_MISMATCH',
    );
    changed.observation.viewportWidth = 1200;
    changed.observation.observations[0].targets[0].conditionStates = [false];
    expect(summarizeConditionCoverage([plan], [changed], ['probe']).keys[0].status).toBe(
      'CONDITION_TRUTH_MISMATCH',
    );
  });
  it('does not silently treat browser-quantized decimal boundaries as exact samples', () => {
    const changed = structuredClone(sample);
    changed.observation.observations[0].targets[0].containers[0].width = 599.296875;
    const fractional = {
      ...required,
      width: 599.3,
      partition: { ...required.partition, host: '[599.3]' },
    };
    expect(
      summarizeConditionCoverage([{ ...plan, requirements: [fractional] }], [changed], ['probe'])
        .keys[0].status,
    ).toBe('ENVIRONMENT_MISMATCH');
  });
  it('retains activation failures and missing targets', () => {
    const changed = structuredClone(sample);
    changed.observation.observations[0].targets[0].active = false;
    expect(summarizeConditionCoverage([plan], [changed], ['probe']).keys[0].status).toBe(
      'ACTIVATION_MISMATCH',
    );
    changed.observation.observations[0].targets = [];
    expect(summarizeConditionCoverage([plan], [changed], ['probe']).keys[0].status).toBe(
      'TARGET_UNMOUNTED',
    );
  });
  it('checks the actual direction and nearest named query container, not just the presence of an outer host', () => {
    const changed = structuredClone(sample);
    changed.observation.direction = 'rtl';
    expect(summarizeConditionCoverage([plan], [changed], ['probe']).keys[0].status).toBe(
      'ENVIRONMENT_MISMATCH',
    );
    changed.observation.direction = 'ltr';
    changed.observation.observations[0].targets[0].containers.unshift({
      key: 'root.0.1.inner',
      name: 'card',
      type: 'inline-size',
      width: 600,
    });
    expect(summarizeConditionCoverage([plan], [changed], ['probe']).keys[0].status).toBe(
      'ENVIRONMENT_MISMATCH',
    );
  });
  it('does not certify content width when query-container scrollbar metrics are unproven', () => {
    const changed = structuredClone(sample);
    changed.observation.observations[0].targets[0].containers[0].metricsTrusted = false;
    expect(summarizeConditionCoverage([plan], [changed], ['probe']).keys[0].status).toBe(
      'ENVIRONMENT_MISMATCH',
    );
  });
});
