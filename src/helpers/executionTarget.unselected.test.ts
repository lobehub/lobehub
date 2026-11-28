import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  isExecutionTargetUnselected,
  isProjectDirectoryTargetDecided,
  resolveExecutionTarget,
} from './executionTarget';

const cfg = (over: Partial<LobeAgentAgencyConfig> = {}): LobeAgentAgencyConfig => ({ ...over });

describe('isExecutionTargetUnselected', () => {
  const hetero = cfg({ heterogeneousProvider: { command: 'claude', type: 'claude-code' } });
  const resolveOnDesktop = (config: LobeAgentAgencyConfig) =>
    resolveExecutionTarget(config, { clientExecutionAvailable: true, isHetero: true });

  it('treats the desktop `local` fallback with nothing stored as unselected', () => {
    expect(resolveOnDesktop(hetero)).toBe('local');
    expect(isExecutionTargetUnselected(hetero, resolveOnDesktop(hetero))).toBe(true);
  });

  it('keeps an explicit `local` pick', () => {
    const picked = { ...hetero, boundDeviceId: 'this-machine', executionTarget: 'local' as const };
    expect(isExecutionTargetUnselected(picked, resolveOnDesktop(picked))).toBe(false);
  });

  it('keeps a bound device with no stored target', () => {
    const bound = { ...hetero, boundDeviceId: 'mac' };
    expect(isExecutionTargetUnselected(bound, 'local')).toBe(false);
  });

  it('does not flag an unset target that resolves elsewhere', () => {
    expect(isExecutionTargetUnselected(hetero, 'sandbox')).toBe(false);
    expect(isExecutionTargetUnselected(hetero, 'none')).toBe(false);
  });
});

describe('isProjectDirectoryTargetDecided', () => {
  const hetero = cfg({ heterogeneousProvider: { command: 'claude', type: 'claude-code' } });

  it('lets the staged directory answer an unset target', () => {
    expect(isProjectDirectoryTargetDecided(hetero, 'mac-book')).toBe(true);
  });

  it('does not answer for a directory with no device', () => {
    expect(isProjectDirectoryTargetDecided(hetero, undefined)).toBe(false);
  });

  it('keeps a contract fixed to another device as the blocker', () => {
    const fixedElsewhere = {
      ...hetero,
      boundDeviceId: 'win-box',
      executionTargetSelectionPolicy: 'fixed' as const,
    };
    expect(isProjectDirectoryTargetDecided(fixedElsewhere, 'mac-book')).toBe(false);
    expect(
      isProjectDirectoryTargetDecided({ ...fixedElsewhere, boundDeviceId: 'mac-book' }, 'mac-book'),
    ).toBe(true);
  });
});
