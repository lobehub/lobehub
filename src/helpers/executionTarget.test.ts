import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  executionTargetToRuntimeMode,
  resolveExecutionTarget,
  resolveRuntimeMode,
} from './executionTarget';

const cfg = (over: Partial<LobeAgentAgencyConfig> = {}): LobeAgentAgencyConfig => ({ ...over });

describe('resolveExecutionTarget', () => {
  it('returns the stored target verbatim when set', () => {
    expect(resolveExecutionTarget(cfg({ executionTarget: 'device' }), true)).toBe('device');
    expect(resolveExecutionTarget(cfg({ executionTarget: 'sandbox' }), true)).toBe('sandbox');
  });

  it('defaults to local on desktop, sandbox on web when unset', () => {
    expect(resolveExecutionTarget(undefined, true)).toBe('local');
    expect(resolveExecutionTarget(undefined, false)).toBe('sandbox');
    expect(resolveExecutionTarget(cfg(), true)).toBe('local');
    expect(resolveExecutionTarget(cfg(), false)).toBe('sandbox');
  });

  it('coerces a stored `local` to `sandbox` on web (no local filesystem)', () => {
    expect(resolveExecutionTarget(cfg({ executionTarget: 'local' }), false)).toBe('sandbox');
    // …but keeps it on desktop
    expect(resolveExecutionTarget(cfg({ executionTarget: 'local' }), true)).toBe('local');
  });

  it('keeps `device` on web (a bound device is reachable from anywhere)', () => {
    expect(resolveExecutionTarget(cfg({ executionTarget: 'device' }), false)).toBe('device');
  });
});

describe('executionTargetToRuntimeMode', () => {
  it('maps target → tool gate', () => {
    expect(executionTargetToRuntimeMode('local')).toBe('local');
    expect(executionTargetToRuntimeMode('sandbox')).toBe('cloud');
    expect(executionTargetToRuntimeMode('device')).toBe('none');
  });
});

describe('resolveRuntimeMode', () => {
  it('honours the legacy runtimeMode when no executionTarget is set (no-regression)', () => {
    expect(resolveRuntimeMode(undefined, 'cloud', false)).toBe('cloud');
    expect(resolveRuntimeMode(cfg(), 'none', false)).toBe('none');
    expect(resolveRuntimeMode(cfg(), 'local', true)).toBe('local');
  });

  it('derives from the default target when neither executionTarget nor legacy is set', () => {
    // desktop default → local
    expect(resolveRuntimeMode(undefined, undefined, true)).toBe('local');
    // web default → sandbox → cloud (graduates the execution-device feature: an
    // unconfigured web agent now gets cloud sandbox tools instead of 'none')
    expect(resolveRuntimeMode(undefined, undefined, false)).toBe('cloud');
  });

  it('lets an explicit executionTarget override the legacy runtimeMode', () => {
    expect(resolveRuntimeMode(cfg({ executionTarget: 'sandbox' }), 'local', true)).toBe('cloud');
    expect(resolveRuntimeMode(cfg({ executionTarget: 'device' }), 'cloud', true)).toBe('none');
    expect(resolveRuntimeMode(cfg({ executionTarget: 'local' }), 'none', true)).toBe('local');
  });

  it('applies the web `local`→`sandbox` coercion before mapping to runtime mode', () => {
    // executionTarget=local synced from desktop, resolved on web → sandbox → cloud
    expect(resolveRuntimeMode(cfg({ executionTarget: 'local' }), undefined, false)).toBe('cloud');
  });
});
