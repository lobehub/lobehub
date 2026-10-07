import { describe, expect, it } from 'vitest';

import { diagnoseCase } from './diagnosis';

const pass = { passed: true, status: 'completed' };
const fail = { passed: false, status: 'completed' };
const error = { passed: null, status: 'error' };
const pending = { passed: null, status: 'pending' };

describe('diagnoseCase', () => {
  it('blames the harness when every judged model fails', () => {
    expect(diagnoseCase([fail, fail, fail, error])).toEqual({
      diagnosis: 'harness',
      failed: 3,
      judged: 3,
      passed: 0,
    });
  });

  it('calls it a model-choice problem when some pass', () => {
    expect(diagnoseCase([fail, pass, pass]).diagnosis).toBe('model');
  });

  it('reports a clean pass when every judged model passes', () => {
    expect(diagnoseCase([pass, pass, error]).diagnosis).toBe('pass');
  });

  it('is inconclusive with fewer than two judged models', () => {
    expect(diagnoseCase([fail, error, pending]).diagnosis).toBe('inconclusive');
    expect(diagnoseCase([]).diagnosis).toBe('inconclusive');
  });
});
