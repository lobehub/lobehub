// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { evaluateGate, exitCode } from './gate';
import type { GateInput } from './types';

const input = (): GateInput => ({
  errors: [],
  fixtures: [{ aaStable: true, comparisons: 1, id: 'button', nodeCount: 2, propertyReads: 12 }],
  findings: [],
  fullScope: true,
  identityVerified: true,
  pureStyleMigration: true,
  units: [
    { componentId: 'button', fixtureIds: ['button'], id: 'root', requiredKeys: ['root:default'] },
  ],
  witnesses: [
    {
      evidenceRefs: ['snapshot.json'],
      fixtureId: 'button',
      key: 'root:default',
      probeId: 'default',
      unitId: 'root',
    },
  ],
});

describe('style migration gate', () => {
  it('passes only complete, stable, identity-verified comparisons', () => {
    const result = evaluateGate(input());
    expect(result).toMatchObject({ gateEligible: true, status: 'PASS' });
    expect(exitCode(result.status)).toBe(0);
  });

  it('keeps an unmounted style unit in the coverage denominator', () => {
    const value = input();
    value.units.push({
      componentId: 'button',
      fixtureIds: [],
      id: 'hidden',
      requiredKeys: ['hidden:hover'],
    });
    const result = evaluateGate(value);
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.coverage).toMatchObject({
      totalUnits: 2,
      machineResolvedUnits: 1,
      missingKeys: ['hidden:hover'],
      unresolvedUnitIds: ['hidden'],
    });
    expect(exitCode(result.status)).toBe(2);
  });

  it.each(['fixtures', 'units', 'witnesses'] as const)(
    'never passes an empty %s collection',
    (key) => {
      const value = input();
      value[key] = [];
      expect(evaluateGate(value).status).not.toBe('PASS');
    },
  );

  it.each(['nodeCount', 'comparisons', 'propertyReads'] as const)(
    'rejects empty %s measurements',
    (key) => {
      const value = input();
      value.fixtures[0][key] = 0;
      expect(evaluateGate(value).status).toBe('ERROR');
    },
  );

  it('does not accept a witness from the wrong fixture or without evidence', () => {
    for (const witness of [
      { ...input().witnesses[0], fixtureId: 'unrelated' },
      { ...input().witnesses[0], evidenceRefs: [] },
      { ...input().witnesses[0], unitId: 'unrelated' },
    ]) {
      expect(evaluateGate({ ...input(), witnesses: [witness] }).status).not.toBe('PASS');
    }
  });

  it('requires every conditional key, not merely one hit per rule', () => {
    const value = input();
    value.units[0].requiredKeys.push('root:hover:media-small');
    expect(evaluateGate(value).coverage.missingKeys).toEqual(['root:hover:media-small']);
  });

  it('fails confirmed differences even when coverage is incomplete', () => {
    const value = input();
    value.witnesses = [];
    value.findings.push({
      confirmed: true,
      id: 'padding',
      reasonCode: 'STYLE_CHANGED',
      severity: 'difference',
    });
    expect(evaluateGate(value).status).toBe('FAIL');
    expect(exitCode(evaluateGate(value).status)).toBe(1);
  });

  it('does not call an unconfirmed difference stable', () => {
    const value = input();
    value.findings.push({
      confirmed: false,
      id: 'padding',
      reasonCode: 'UNSTABLE_DIFFERENCE',
      severity: 'difference',
    });
    expect(evaluateGate(value).status).toBe('NEEDS_REVIEW');
  });

  it('retains failures and missing coverage when an execution error wins', () => {
    const value = input();
    value.errors.push('BROWSER_DISCONNECTED');
    value.witnesses = [];
    value.findings.push({
      confirmed: true,
      id: 'padding',
      reasonCode: 'STYLE_CHANGED',
      severity: 'difference',
    });
    const result = evaluateGate(value);
    expect(result.status).toBe('ERROR');
    expect(result.findings).toHaveLength(1);
    expect(result.coverage.missingKeys).toHaveLength(1);
    expect(exitCode(result.status)).toBe(3);
  });

  it.each(['fullScope', 'identityVerified', 'pureStyleMigration'] as const)(
    'does not issue a gate PASS without %s',
    (key) => {
      expect(evaluateGate({ ...input(), [key]: false })).toMatchObject({
        gateEligible: false,
        status: 'NEEDS_REVIEW',
      });
    },
  );

  it('rejects unstable A/A and missing A/A controls', () => {
    const value = input();
    value.fixtures[0].aaStable = false;
    expect(evaluateGate(value).status).toBe('NEEDS_REVIEW');
  });

  it('does not turn unsupported conditions or empty key sets green', () => {
    const value = input();
    value.units[0].requiredKeys = [];
    expect(evaluateGate(value).status).toBe('NEEDS_REVIEW');
    expect(
      evaluateGate({
        ...input(),
        findings: [
          {
            confirmed: false,
            id: 'highlight',
            reasonCode: 'UNSUPPORTED_HIGHLIGHT',
            severity: 'review',
          },
        ],
      }).status,
    ).toBe('NEEDS_REVIEW');
  });

  it('rejects duplicate IDs and unknown schema fields', () => {
    const value = input();
    value.units.push(value.units[0]);
    expect(() => evaluateGate(value)).toThrow();
    expect(() => evaluateGate({ ...input(), approvedBy: 'author' })).toThrow();
  });
});
