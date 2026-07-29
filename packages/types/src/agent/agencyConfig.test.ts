import { describe, expect, it } from 'vitest';

import type { HeterogeneousProviderConfig } from './agencyConfig';
import {
  buildHeteroExecArgs,
  buildHeteroSpawnArgs,
  codexModelSupportsFastSpeed,
  codexModelSupportsReasoningEffort,
  getCodexReasoningEffortLevels,
  HETEROGENEOUS_AGENT_DEFAULT_SELECTION,
  pruneWorkingDirByDeviceDeletes,
  resolveAgencyConfig,
  resolveAgentAgencyConfig,
  resolveClaudeCodeModel,
  resolveClaudeCodeReasoningEffort,
  resolveCodexModel,
  resolveCodexReasoningEffort,
  resolveCodexSpeedMode,
} from './agencyConfig';

describe('pruneWorkingDirByDeviceDeletes', () => {
  it('deletes keys whose patch value is undefined', () => {
    const merged = { workingDirByDevice: { 'device-a': '/a', 'device-b': '/b' } };
    pruneWorkingDirByDeviceDeletes(merged, { workingDirByDevice: { 'device-a': undefined } });
    expect(merged.workingDirByDevice).toEqual({ 'device-b': '/b' });
  });

  it('leaves defined patch values untouched', () => {
    const merged = { workingDirByDevice: { 'device-a': '/a' } };
    pruneWorkingDirByDeviceDeletes(merged, { workingDirByDevice: { 'device-a': '/a' } });
    expect(merged.workingDirByDevice).toEqual({ 'device-a': '/a' });
  });

  it('is a no-op when the patch has no workingDirByDevice', () => {
    const merged = { workingDirByDevice: { 'device-a': '/a' } };
    pruneWorkingDirByDeviceDeletes(merged, {});
    pruneWorkingDirByDeviceDeletes(merged, undefined);
    pruneWorkingDirByDeviceDeletes(merged, null);
    expect(merged.workingDirByDevice).toEqual({ 'device-a': '/a' });
  });

  it('is a no-op when the merged target has no workingDirByDevice', () => {
    expect(() =>
      pruneWorkingDirByDeviceDeletes({}, { workingDirByDevice: { 'device-a': undefined } }),
    ).not.toThrow();
    expect(() =>
      pruneWorkingDirByDeviceDeletes(undefined, { workingDirByDevice: { 'device-a': undefined } }),
    ).not.toThrow();
  });
});

describe('buildHeteroSpawnArgs', () => {
  it('resolves missing Claude Code selections to Default', () => {
    expect(resolveClaudeCodeModel(undefined)).toBe(HETEROGENEOUS_AGENT_DEFAULT_SELECTION);
    expect(resolveClaudeCodeReasoningEffort(undefined)).toBe(HETEROGENEOUS_AGENT_DEFAULT_SELECTION);
  });

  it('resolves missing Codex selections to Default', () => {
    expect(resolveCodexModel(undefined)).toBe(HETEROGENEOUS_AGENT_DEFAULT_SELECTION);
    expect(resolveCodexReasoningEffort(undefined)).toBe(HETEROGENEOUS_AGENT_DEFAULT_SELECTION);
  });

  it('returns undefined when there is no provider', () => {
    expect(buildHeteroSpawnArgs(undefined)).toBeUndefined();
    expect(buildHeteroSpawnArgs(null)).toBeUndefined();
  });

  it('leaves remote providers untouched', () => {
    expect(buildHeteroSpawnArgs({ args: ['--agent', 'main'], type: 'openclaw' })).toEqual([
      '--agent',
      'main',
    ]);
  });

  it('passes AMP native args through direct spawns and encodes them for lh hetero exec', () => {
    const provider: HeterogeneousProviderConfig = { args: ['--mode', 'high'], type: 'amp' };

    expect(buildHeteroSpawnArgs(provider)).toEqual(['--mode', 'high']);
    expect(buildHeteroExecArgs(provider)).toEqual(['--agent-arg=--mode', '--agent-arg=high']);
  });

  it('forwards OpenCode native args and an explicit provider/model selection', () => {
    const provider: HeterogeneousProviderConfig = {
      args: ['--variant', 'high'],
      model: 'anthropic/claude-sonnet-4',
      type: 'opencode',
    };

    expect(buildHeteroSpawnArgs(provider)).toEqual([
      '--variant',
      'high',
      '--model',
      'anthropic/claude-sonnet-4',
    ]);
    expect(buildHeteroExecArgs(provider)).toEqual([
      '--agent-arg=--variant',
      '--agent-arg=high',
      '--model',
      'anthropic/claude-sonnet-4',
    ]);
  });

  it('does not duplicate an OpenCode model already present in native args', () => {
    const provider: HeterogeneousProviderConfig = {
      args: ['--model=google/gemini-2.5-pro'],
      model: 'anthropic/claude-sonnet-4',
      type: 'opencode',
    };

    expect(buildHeteroSpawnArgs(provider)).toEqual(['--model=google/gemini-2.5-pro']);
    expect(buildHeteroExecArgs(provider)).toEqual(['--agent-arg=--model=google/gemini-2.5-pro']);
  });

  it('honors the OpenCode short model flag in native args', () => {
    const provider: HeterogeneousProviderConfig = {
      args: ['-m', 'google/gemini-2.5-pro'],
      model: 'anthropic/claude-sonnet-4',
      type: 'opencode',
    };

    expect(buildHeteroSpawnArgs(provider)).toEqual(['-m', 'google/gemini-2.5-pro']);
    expect(buildHeteroExecArgs(provider)).toEqual([
      '--agent-arg=-m',
      '--agent-arg=google/gemini-2.5-pro',
    ]);
  });

  it('preserves Claude Code defaults when model/effort have not been selected', () => {
    expect(buildHeteroSpawnArgs({ type: 'claude-code' })).toBeUndefined();
    expect(buildHeteroSpawnArgs({ args: ['--verbose'], type: 'claude-code' })).toEqual([
      '--verbose',
    ]);
    // Older persisted "Default" selections should behave like unset values.
    expect(
      buildHeteroSpawnArgs({
        effort: HETEROGENEOUS_AGENT_DEFAULT_SELECTION,
        model: HETEROGENEOUS_AGENT_DEFAULT_SELECTION,
        type: 'claude-code',
      }),
    ).toBeUndefined();
  });

  it('preserves Codex defaults when model/effort have not been selected', () => {
    expect(buildHeteroSpawnArgs({ type: 'codex' })).toBeUndefined();
    expect(buildHeteroSpawnArgs({ args: ['--ask-for-approval', 'never'], type: 'codex' })).toEqual([
      '--ask-for-approval',
      'never',
    ]);
    expect(
      buildHeteroSpawnArgs({
        effort: HETEROGENEOUS_AGENT_DEFAULT_SELECTION,
        model: HETEROGENEOUS_AGENT_DEFAULT_SELECTION,
        type: 'codex',
      }),
    ).toBeUndefined();
  });

  it('appends --model and --effort for claude-code', () => {
    expect(buildHeteroSpawnArgs({ type: 'claude-code', model: 'opus', effort: 'high' })).toEqual([
      '--model',
      'opus',
      '--effort',
      'high',
    ]);
  });

  it('preserves existing args and appends after them', () => {
    expect(
      buildHeteroSpawnArgs({ args: ['--verbose'], type: 'claude-code', model: 'sonnet' }),
    ).toEqual(['--verbose', '--model', 'sonnet']);
  });

  it('only appends explicitly selected flags', () => {
    expect(buildHeteroSpawnArgs({ type: 'claude-code', effort: 'max' })).toEqual([
      '--effort',
      'max',
    ]);
    expect(buildHeteroSpawnArgs({ type: 'claude-code', model: 'haiku' })).toEqual([
      '--model',
      'haiku',
    ]);
  });

  it('does not duplicate a flag the user already authored in args', () => {
    // space-separated form
    expect(
      buildHeteroSpawnArgs({
        args: ['--model', 'opus'],
        type: 'claude-code',
        model: 'sonnet',
        effort: 'high',
      }),
    ).toEqual(['--model', 'opus', '--effort', 'high']);
    // `--flag=value` form
    expect(
      buildHeteroSpawnArgs({
        args: ['--effort=low'],
        type: 'claude-code',
        model: 'opus',
        effort: 'high',
      }),
    ).toEqual(['--effort=low', '--model', 'opus']);
  });

  it('resolves Codex model and reasoning effort from args before persisted selections', () => {
    expect(
      resolveCodexModel({
        args: ['--model', 'gpt-5.4'],
        model: 'gpt-5.5',
      }),
    ).toBe('gpt-5.4');
    expect(
      resolveCodexModel({
        args: ['-c', 'model = "gpt-5.3-codex-spark"'],
        model: 'gpt-5.5',
      }),
    ).toBe('gpt-5.3-codex-spark');
    expect(
      resolveCodexReasoningEffort({
        args: ['--config=model_reasoning_effort="xhigh"'],
        effort: 'low',
      }),
    ).toBe('xhigh');
    expect(resolveCodexReasoningEffort({ effort: 'max' })).toBe('max');
    expect(resolveCodexReasoningEffort({ args: ['-c', 'model_reasoning_effort="ultra"'] })).toBe(
      'ultra',
    );
  });

  it('appends --model and model_reasoning_effort config for Codex', () => {
    expect(buildHeteroSpawnArgs({ type: 'codex', model: 'gpt-5.5', effort: 'high' })).toEqual([
      '--model',
      'gpt-5.5',
      '-c',
      'model_reasoning_effort="high"',
    ]);
  });

  it('passes extended Codex reasoning efforts through spawn and exec args', () => {
    expect(buildHeteroSpawnArgs({ effort: 'ultra', model: 'gpt-5.6-sol', type: 'codex' })).toEqual([
      '--model',
      'gpt-5.6-sol',
      '-c',
      'model_reasoning_effort="ultra"',
    ]);
    expect(buildHeteroExecArgs({ effort: 'max', model: 'gpt-5.6-luna', type: 'codex' })).toEqual([
      '--model',
      'gpt-5.6-luna',
      '--effort',
      'max',
    ]);
  });

  it('does not duplicate Codex args the user already authored', () => {
    expect(
      buildHeteroSpawnArgs({
        args: ['-m', 'gpt-5.4'],
        effort: 'high',
        model: 'gpt-5.5',
        type: 'codex',
      }),
    ).toEqual(['-m', 'gpt-5.4', '-c', 'model_reasoning_effort="high"']);
    expect(
      buildHeteroSpawnArgs({
        args: ['--config=model_reasoning_effort="low"'],
        effort: 'high',
        model: 'gpt-5.5',
        type: 'codex',
      }),
    ).toEqual(['--config=model_reasoning_effort="low"', '--model', 'gpt-5.5']);
    expect(
      buildHeteroSpawnArgs({
        args: ['-c', 'model = "gpt-5.4"'],
        model: 'gpt-5.5',
        type: 'codex',
      }),
    ).toEqual(['-c', 'model = "gpt-5.4"']);
  });

  it('builds lh hetero exec wrapper args for Codex selectors', () => {
    expect(buildHeteroExecArgs({ type: 'codex', model: 'gpt-5.5', effort: 'high' })).toEqual([
      '--model',
      'gpt-5.5',
      '--effort',
      'high',
    ]);
  });

  it('does not append native Codex config flags to lh hetero exec args', () => {
    expect(
      buildHeteroExecArgs({
        args: ['-c', 'model = "gpt-5.4"'],
        effort: 'xhigh',
        type: 'codex',
      }),
    ).toEqual(['--agent-arg=-c', '--agent-arg=model = "gpt-5.4"', '--effort', 'xhigh']);
  });

  it('keeps Claude Code lh hetero exec selector args in the same wrapper form', () => {
    expect(buildHeteroExecArgs({ type: 'claude-code', model: 'opus', effort: 'high' })).toEqual([
      '--model',
      'opus',
      '--effort',
      'high',
    ]);
  });

  it('encodes native agent args before forwarding them to lh hetero exec', () => {
    expect(
      buildHeteroExecArgs({
        args: ['--ask-for-approval', 'never'],
        model: 'gpt-5.5',
        type: 'codex',
      }),
    ).toEqual(['--agent-arg=--ask-for-approval', '--agent-arg=never', '--model', 'gpt-5.5']);

    expect(
      buildHeteroExecArgs({
        args: ['--verbose'],
        effort: 'high',
        type: 'claude-code',
      }),
    ).toEqual(['--agent-arg=--verbose', '--effort', 'high']);
  });
});

describe('codex reasoning effort capabilities', () => {
  const commonLevels = ['low', 'medium', 'high', 'xhigh'];
  const maxLevels = [...commonLevels, 'max'];
  const ultraLevels = [...maxLevels, 'ultra'];

  it('returns the extended levels supported by each GPT-5.6 model', () => {
    expect(getCodexReasoningEffortLevels('gpt-5.6')).toEqual(ultraLevels);
    expect(getCodexReasoningEffortLevels('gpt-5.6-sol')).toEqual(ultraLevels);
    expect(getCodexReasoningEffortLevels('gpt-5.6-terra')).toEqual(ultraLevels);
    expect(getCodexReasoningEffortLevels('gpt-5.6-luna')).toEqual(maxLevels);
  });

  it('reports model-specific Max and Ultra support', () => {
    expect(codexModelSupportsReasoningEffort('gpt-5.6', 'ultra')).toBe(true);
    expect(codexModelSupportsReasoningEffort('gpt-5.6-sol', 'ultra')).toBe(true);
    expect(codexModelSupportsReasoningEffort('gpt-5.6-terra', 'ultra')).toBe(true);
    expect(codexModelSupportsReasoningEffort('gpt-5.6-luna', 'max')).toBe(true);
    expect(codexModelSupportsReasoningEffort('gpt-5.6-luna', 'ultra')).toBe(false);
  });

  it('uses conservative common levels for old, unknown, and default models', () => {
    expect(getCodexReasoningEffortLevels('gpt-5.5')).toEqual(commonLevels);
    expect(getCodexReasoningEffortLevels('gpt-5.4-mini')).toEqual(commonLevels);
    expect(getCodexReasoningEffortLevels('custom-codex-model')).toEqual(commonLevels);
    expect(getCodexReasoningEffortLevels(HETEROGENEOUS_AGENT_DEFAULT_SELECTION)).toEqual(
      commonLevels,
    );
  });
});

describe('codex speed mode', () => {
  it('resolves missing / default selections to Default', () => {
    expect(resolveCodexSpeedMode(undefined)).toBe(HETEROGENEOUS_AGENT_DEFAULT_SELECTION);
    expect(resolveCodexSpeedMode({ speed: HETEROGENEOUS_AGENT_DEFAULT_SELECTION })).toBe(
      HETEROGENEOUS_AGENT_DEFAULT_SELECTION,
    );
  });

  it('resolves persisted fast selections', () => {
    expect(resolveCodexSpeedMode({ speed: 'fast' })).toBe('fast');
  });

  it('resolves service_tier from args before persisted selections', () => {
    expect(resolveCodexSpeedMode({ args: ['-c', 'service_tier="fast"'] })).toBe('fast');
    // The native request value spelling counts as fast too.
    expect(resolveCodexSpeedMode({ args: ['--config=service_tier="priority"'] })).toBe('fast');
    // Unknown tiers (e.g. flex) are displayed as Standard.
    expect(resolveCodexSpeedMode({ args: ['-c', 'service_tier="flex"'], speed: 'fast' })).toBe(
      HETEROGENEOUS_AGENT_DEFAULT_SELECTION,
    );
  });

  it('reports fast support for catalog models and the default selection', () => {
    expect(codexModelSupportsFastSpeed(HETEROGENEOUS_AGENT_DEFAULT_SELECTION)).toBe(true);
    expect(codexModelSupportsFastSpeed('gpt-5.6')).toBe(true);
    expect(codexModelSupportsFastSpeed('gpt-5.6-sol')).toBe(true);
    expect(codexModelSupportsFastSpeed('gpt-5.6-terra')).toBe(true);
    expect(codexModelSupportsFastSpeed('gpt-5.6-luna')).toBe(true);
    expect(codexModelSupportsFastSpeed('gpt-5.5')).toBe(true);
    expect(codexModelSupportsFastSpeed('gpt-5.4')).toBe(true);
    expect(codexModelSupportsFastSpeed('gpt-5.4-mini')).toBe(false);
    expect(codexModelSupportsFastSpeed('gpt-5.3-codex-spark')).toBe(false);
  });

  it('appends service_tier config for Codex spawns when fast is selected', () => {
    expect(buildHeteroSpawnArgs({ speed: 'fast', type: 'codex' })).toEqual([
      '-c',
      'service_tier="fast"',
    ]);
    expect(buildHeteroSpawnArgs({ effort: 'high', speed: 'fast', type: 'codex' })).toEqual([
      '-c',
      'model_reasoning_effort="high"',
      '-c',
      'service_tier="fast"',
    ]);
  });

  it('does not append service_tier for default speed or user-authored overrides', () => {
    expect(
      buildHeteroSpawnArgs({ speed: HETEROGENEOUS_AGENT_DEFAULT_SELECTION, type: 'codex' }),
    ).toBeUndefined();
    expect(
      buildHeteroSpawnArgs({
        args: ['-c', 'service_tier="priority"'],
        speed: 'fast',
        type: 'codex',
      }),
    ).toEqual(['-c', 'service_tier="priority"']);
  });

  it('ignores speed for claude-code spawns', () => {
    expect(buildHeteroSpawnArgs({ speed: 'fast', type: 'claude-code' })).toBeUndefined();
  });

  it('keeps lh hetero exec speed overrides in wrapper form', () => {
    expect(buildHeteroExecArgs({ model: 'gpt-5.5', speed: 'fast', type: 'codex' })).toEqual([
      '--model',
      'gpt-5.5',
      '--speed',
      'fast',
    ]);
    expect(
      buildHeteroExecArgs({
        args: ['-c', 'service_tier="priority"'],
        speed: 'fast',
        type: 'codex',
      }),
    ).toEqual(['--agent-arg=-c', '--agent-arg=service_tier="priority"']);
    expect(buildHeteroExecArgs({ speed: 'fast', type: 'claude-code' })).toBeUndefined();
  });
});

describe('resolveAgencyConfig', () => {
  it('ignores a member override when the shared execution target is fixed', () => {
    const shared = {
      boundDeviceId: 'fixed-device',
      executionTargetSelectionPolicy: 'fixed' as const,
      executionTarget: 'device' as const,
    };

    expect(
      resolveAgencyConfig(shared, {
        boundDeviceId: 'member-device',
        executionTarget: 'sandbox',
      }),
    ).toEqual(shared);
  });

  it('keeps a fixed non-device target when a member requests a device', () => {
    const shared = {
      executionTarget: 'sandbox' as const,
      executionTargetSelectionPolicy: 'fixed' as const,
    };

    expect(
      resolveAgencyConfig(shared, {
        boundDeviceId: 'member-device',
        executionTarget: 'device',
      }),
    ).toEqual(shared);
  });

  it('returns the shared config unchanged when override is null / undefined', () => {
    const shared = { boundDeviceId: 'ws-device', executionTarget: 'device' as const };
    expect(resolveAgencyConfig(shared, undefined)).toEqual(shared);
    expect(resolveAgencyConfig(shared, null)).toEqual(shared);
  });

  it('returns the shared config unchanged when override has neither field set', () => {
    const shared = { boundDeviceId: 'ws-device', executionTarget: 'device' as const };
    expect(resolveAgencyConfig(shared, {})).toEqual(shared);
  });

  it("override's executionTarget wins over the shared value", () => {
    const shared = { boundDeviceId: 'ws-device', executionTarget: 'device' as const };
    expect(resolveAgencyConfig(shared, { executionTarget: 'sandbox' })).toEqual({
      boundDeviceId: 'ws-device',
      executionTarget: 'sandbox',
    });
  });

  it("override's boundDeviceId wins over the shared value", () => {
    const shared = { boundDeviceId: 'ws-device', executionTarget: 'device' as const };
    expect(resolveAgencyConfig(shared, { boundDeviceId: 'my-mac' })).toEqual({
      boundDeviceId: 'my-mac',
      executionTarget: 'device',
    });
  });

  it("override's local + boundDeviceId sets both together (workspace-mode `local` case)", () => {
    const shared = { boundDeviceId: 'ws-device', executionTarget: 'device' as const };
    expect(
      resolveAgencyConfig(shared, { boundDeviceId: 'my-mac', executionTarget: 'local' }),
    ).toEqual({ boundDeviceId: 'my-mac', executionTarget: 'local' });
  });

  it('does NOT touch heterogeneousProvider / workingDirByDevice — those are shared', () => {
    const shared = {
      boundDeviceId: 'ws-device',
      executionTarget: 'device' as const,
      heterogeneousProvider: { type: 'claude-code' as const },
      workingDirByDevice: { 'ws-device': '/workspace' },
    };
    const merged = resolveAgencyConfig(shared, {
      boundDeviceId: 'my-mac',
      executionTarget: 'local',
    });
    expect(merged?.heterogeneousProvider).toEqual({ type: 'claude-code' });
    expect(merged?.workingDirByDevice).toEqual({ 'ws-device': '/workspace' });
    expect(merged?.boundDeviceId).toBe('my-mac');
    expect(merged?.executionTarget).toBe('local');
  });

  it('coerces null shared config to undefined', () => {
    expect(resolveAgencyConfig(null, undefined)).toBeUndefined();
    expect(resolveAgencyConfig(undefined, undefined)).toBeUndefined();
  });

  it('an override with only executionTarget leaves the shared boundDeviceId in place', () => {
    const shared = { boundDeviceId: 'ws-device', executionTarget: 'device' as const };
    expect(resolveAgencyConfig(shared, { executionTarget: 'sandbox' })).toEqual({
      boundDeviceId: 'ws-device',
      executionTarget: 'sandbox',
    });
  });

  it('an override that unsets executionTarget by setting it to a defined value replaces the shared', () => {
    // Merge semantics: `undefined` in the override is treated as "not overriding".
    // Only *defined* values in the override win. Test both branches.
    const shared = { executionTarget: 'device' as const };
    expect(resolveAgencyConfig(shared, { executionTarget: undefined })).toEqual(shared);
    expect(resolveAgencyConfig(shared, { executionTarget: 'none' })).toEqual({
      executionTarget: 'none',
    });
  });
});

describe('resolveAgentAgencyConfig', () => {
  it('applies the fixed member policy to a public Workspace Agent', () => {
    const shared = {
      boundDeviceId: 'shared-device',
      executionTarget: 'device' as const,
      executionTargetSelectionPolicy: 'fixed' as const,
    };

    expect(
      resolveAgentAgencyConfig(
        shared,
        { boundDeviceId: 'member-device', executionTarget: 'local' },
        { visibility: 'public', workspaceId: 'workspace-1' },
      ),
    ).toEqual(shared);
  });

  it('ignores member policy and overrides while a Workspace Agent is private', () => {
    expect(
      resolveAgentAgencyConfig(
        {
          boundDeviceId: 'owner-device',
          executionTarget: 'device',
          executionTargetSelectionPolicy: 'fixed',
        },
        { boundDeviceId: 'stale-member-device', executionTarget: 'local' },
        { visibility: 'private', workspaceId: 'workspace-1' },
      ),
    ).toEqual({ boundDeviceId: 'owner-device', executionTarget: 'device' });
  });

  it('ignores member policy and overrides for an author or Workspace admin', () => {
    expect(
      resolveAgentAgencyConfig(
        {
          boundDeviceId: 'shared-device',
          executionTarget: 'device',
          executionTargetSelectionPolicy: 'fixed',
        },
        { boundDeviceId: 'member-device', executionTarget: 'local' },
        { canManage: true, visibility: 'public', workspaceId: 'workspace-1' },
      ),
    ).toEqual({ boundDeviceId: 'shared-device', executionTarget: 'device' });
  });
});
