import { describe, expect, it } from 'vitest';

import type { HeterogeneousProviderConfig } from './agencyConfig';
import {
  applyTopicModelToHeterogeneousProvider,
  buildHeteroExecArgs,
  buildHeteroSpawnArgs,
  canPublishAgentTopicLink,
  formatServerDefaultHeterogeneousModel,
  isServerDefaultHeterogeneousModel,
  normalizeHeterogeneousProviderConfig,
  pruneWorkingDirByDeviceDeletes,
  resolveAgencyConfig,
  resolveAgentAgencyConfig,
  resolveAgentTopicSharePolicy,
  resolveHeterogeneousProviderTopicModel,
  unwrapServerDefaultHeterogeneousModel,
} from './agencyConfig';
import {
  AMP_AGENT_MODES,
  codexModelSupportsFastSpeed,
  getCodexReasoningEffortLevels,
  HETEROGENEOUS_AGENT_DEFAULT_SELECTION,
  resolveAmpAgentMode,
  resolveClaudeCodeModel,
  resolveClaudeCodeReasoningEffort,
  resolveCodexModel,
  resolveCodexReasoningEffort,
  resolveCodexSpeedMode,
} from './heteroSelectorCapabilities';

describe('server-default heterogeneous model request', () => {
  it('only accepts the namespaced operation model used for CLI metadata', () => {
    expect(formatServerDefaultHeterogeneousModel('gpt-5.4')).toBe('lobehub/gpt-5.4');
    expect(isServerDefaultHeterogeneousModel('lobehub/gpt-5.4', 'gpt-5.4')).toBe(true);
    expect(isServerDefaultHeterogeneousModel('lobehub-default', 'gpt-5.4')).toBe(false);
    expect(isServerDefaultHeterogeneousModel('lobehub/gpt-5.5', 'gpt-5.4')).toBe(false);
  });

  it('unwraps namespaced CLI reports and the legacy Claude Code alias', () => {
    expect(unwrapServerDefaultHeterogeneousModel('lobehub/claude-sonnet-4-6')).toBe(
      'claude-sonnet-4-6',
    );
    expect(unwrapServerDefaultHeterogeneousModel('lobehub/gpt-5.4', 'ignored')).toBe('gpt-5.4');
    expect(unwrapServerDefaultHeterogeneousModel('lobehub-default', 'claude-sonnet-4-6')).toBe(
      'claude-sonnet-4-6',
    );
    expect(unwrapServerDefaultHeterogeneousModel('lobehub-default')).toBe('lobehub-default');
    expect(unwrapServerDefaultHeterogeneousModel('claude-opus-4-6', 'claude-sonnet-4-6')).toBe(
      'claude-opus-4-6',
    );
    expect(unwrapServerDefaultHeterogeneousModel(undefined, 'claude-sonnet-4-6')).toBe(
      'claude-sonnet-4-6',
    );
  });
});

describe('normalizeHeterogeneousProviderConfig', () => {
  it('recovers a legacy adapterType before considering the command', () => {
    const legacyConfig = {
      adapterType: 'codex',
      command: 'claude',
    } as unknown as HeterogeneousProviderConfig;

    expect(normalizeHeterogeneousProviderConfig(legacyConfig)).toEqual({
      command: 'claude',
      type: 'codex',
    });
  });

  it('infers legacy Claude Code and Codex identities from their commands', () => {
    const legacyClaudeConfig = {
      command: '/usr/local/bin/custom-claude',
    } as unknown as HeterogeneousProviderConfig;
    const legacyCodexConfig = {
      command: '/usr/local/bin/custom-codex',
    } as unknown as HeterogeneousProviderConfig;

    expect(normalizeHeterogeneousProviderConfig(legacyClaudeConfig).type).toBe('claude-code');
    expect(normalizeHeterogeneousProviderConfig(legacyCodexConfig).type).toBe('codex');
  });

  it('preserves the legacy Claude Code default when no identity can be recovered', () => {
    const legacyConfig = { command: 'custom-agent' } as unknown as HeterogeneousProviderConfig;

    expect(normalizeHeterogeneousProviderConfig(legacyConfig).type).toBe('claude-code');
  });
});

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

describe('heterogeneous topic models', () => {
  it('snapshots the persisted selector and Default', () => {
    expect(
      resolveHeterogeneousProviderTopicModel({
        args: ['--model', 'cursor-arg-model'],
        model: 'stale-structured-model',
        type: 'cursor',
      }),
    ).toEqual({ model: 'stale-structured-model', provider: 'cursor' });
    expect(resolveHeterogeneousProviderTopicModel({ type: 'cursor' })).toEqual({
      model: HETEROGENEOUS_AGENT_DEFAULT_SELECTION,
      provider: 'cursor',
    });
  });

  it('keeps server-default API models Agent-scoped and ignores stale topic bindings', () => {
    const config = {
      apiConfig: { model: 'server-model', source: 'server-default' },
      authMode: 'api',
      type: 'claude-code',
    } as const;

    expect(resolveHeterogeneousProviderTopicModel(config)).toBeUndefined();
    expect(
      applyTopicModelToHeterogeneousProvider(config, {
        model: 'stale-topic-model',
        provider: 'anthropic',
      }),
    ).toBe(config);
  });

  it('overrides a CLI model without retaining a conflicting global flag', () => {
    const effective = applyTopicModelToHeterogeneousProvider(
      {
        args: ['--model', 'global-model', '--mode', 'plan'],
        model: 'global-model',
        type: 'cursor',
      },
      { model: 'topic-model', provider: 'cursor' },
    );

    expect(effective).toEqual({
      args: ['--mode', 'plan'],
      model: 'topic-model',
      type: 'cursor',
    });
    expect(buildHeteroSpawnArgs(effective)).toEqual(['--mode', 'plan', '--model', 'topic-model']);
  });

  it('overrides an API binding and drops a provider-specific fast model', () => {
    expect(
      applyTopicModelToHeterogeneousProvider(
        {
          apiConfig: {
            model: 'global-model',
            providerId: 'openai',
            smallFastModel: 'gpt-4.1-mini',
          },
          authMode: 'api',
          type: 'cursor',
        },
        { model: 'topic-model', provider: 'anthropic' },
      ),
    ).toMatchObject({
      apiConfig: { model: 'topic-model', providerId: 'anthropic' },
      authMode: 'api',
      type: 'cursor',
    });
  });

  it('ignores a topic model pinned for another heterogeneous runtime', () => {
    const config = { model: 'global-model', type: 'cursor' } as const;

    expect(
      applyTopicModelToHeterogeneousProvider(config, {
        model: 'codex-topic-model',
        provider: 'codex',
      }),
    ).toBe(config);
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

  it('resolves Amp mode from native args before the structured field', () => {
    expect(resolveAmpAgentMode(undefined)).toBe(HETEROGENEOUS_AGENT_DEFAULT_SELECTION);
    expect(resolveAmpAgentMode({ mode: 'high' })).toBe('high');
    expect(resolveAmpAgentMode({ args: ['--mode=ultra'], mode: 'low' })).toBe('ultra');
  });

  it.each(AMP_AGENT_MODES)(
    'forwards structured Amp mode %s through direct and legacy-compatible device paths',
    (mode) => {
      const provider: HeterogeneousProviderConfig = { mode, type: 'amp' };

      expect(buildHeteroSpawnArgs(provider)).toEqual(['--mode', mode]);
      expect(buildHeteroExecArgs(provider)).toEqual(['--agent-arg=--mode', `--agent-arg=${mode}`]);
    },
  );

  it('does not override Amp mode when Default is selected', () => {
    const provider: HeterogeneousProviderConfig = {
      mode: HETEROGENEOUS_AGENT_DEFAULT_SELECTION,
      type: 'amp',
    };

    expect(buildHeteroSpawnArgs(provider)).toBeUndefined();
    expect(buildHeteroExecArgs(provider)).toBeUndefined();
  });

  it('keeps raw Amp args compatible with direct spawns and lh hetero exec', () => {
    const provider: HeterogeneousProviderConfig = { args: ['--mode', 'high'], type: 'amp' };

    expect(buildHeteroSpawnArgs(provider)).toEqual(['--mode', 'high']);
    expect(buildHeteroExecArgs(provider)).toEqual(['--agent-arg=--mode', '--agent-arg=high']);
  });

  it('forwards Cursor native args and configured model without duplicating --model', () => {
    const provider: HeterogeneousProviderConfig = {
      args: ['--mode', 'plan'],
      model: 'sonnet-4-thinking',
      type: 'cursor',
    };

    expect(buildHeteroSpawnArgs(provider)).toEqual([
      '--mode',
      'plan',
      '--model',
      'sonnet-4-thinking',
    ]);
    expect(buildHeteroExecArgs(provider)).toEqual([
      '--agent-arg=--mode',
      '--agent-arg=plan',
      '--model',
      'sonnet-4-thinking',
    ]);
    expect(
      buildHeteroSpawnArgs({
        args: ['--model', 'gpt-5'],
        model: 'sonnet-4-thinking',
        type: 'cursor',
      }),
    ).toEqual(['--model', 'gpt-5']);
  });

  it('forwards Grok Build model and effort through direct ACP and device execution', () => {
    const provider: HeterogeneousProviderConfig = {
      args: ['--no-subagents'],
      effort: 'xhigh',
      model: 'grok-4.6',
      type: 'grok-build',
    };

    expect(buildHeteroSpawnArgs(provider)).toEqual([
      '--no-subagents',
      '--model',
      'grok-4.6',
      '--effort',
      'xhigh',
    ]);
    expect(buildHeteroExecArgs(provider)).toEqual([
      '--agent-arg=--no-subagents',
      '--agent-arg=--model',
      '--agent-arg=grok-4.6',
      '--agent-arg=--effort',
      '--agent-arg=xhigh',
    ]);
  });

  it('keeps native Grok Build selector flags authoritative', () => {
    const provider: HeterogeneousProviderConfig = {
      args: ['-m=grok-build', '--reasoning-effort=low'],
      effort: 'high',
      model: 'grok-4.6',
      type: 'grok-build',
    };

    expect(buildHeteroSpawnArgs(provider)).toEqual(['-m=grok-build', '--reasoning-effort=low']);
    expect(buildHeteroExecArgs(provider)).toEqual([
      '--agent-arg=-m=grok-build',
      '--agent-arg=--reasoning-effort=low',
    ]);
  });

  it('keeps TRAE model selection in the wrapper instead of native process arguments', () => {
    const provider: HeterogeneousProviderConfig = {
      args: ['--feature', 'test'],
      effort: 'high',
      model: 'ignored-selector',
      type: 'trae',
    };

    expect(buildHeteroSpawnArgs(provider)).toEqual(['--feature', 'test']);
    expect(buildHeteroExecArgs(provider)).toEqual([
      '--agent-arg=--feature',
      '--agent-arg=test',
      '--model',
      'ignored-selector',
    ]);
  });

  it('forwards Qoder native args, model, and reasoning effort', () => {
    const provider: HeterogeneousProviderConfig = {
      args: ['--verbose'],
      effort: 'high',
      model: 'qoder-model',
      type: 'qoder',
    };

    expect(buildHeteroSpawnArgs(provider)).toEqual([
      '--verbose',
      '--model',
      'qoder-model',
      '--reasoning-effort',
      'high',
    ]);
    expect(buildHeteroExecArgs(provider)).toEqual([
      '--agent-arg=--verbose',
      '--model',
      'qoder-model',
      '--effort',
      'high',
    ]);
  });

  it('forwards Kimi Code native args and an explicit model through both spawn paths', () => {
    const provider: HeterogeneousProviderConfig = {
      args: ['--verbose'],
      effort: 'high',
      model: 'kimi-for-coding',
      type: 'kimi-code',
    };

    expect(buildHeteroSpawnArgs(provider)).toEqual(['--verbose', '--model', 'kimi-for-coding']);
    expect(buildHeteroExecArgs(provider)).toEqual([
      '--agent-arg=--verbose',
      '--model',
      'kimi-for-coding',
    ]);
  });

  it('preserves Qoder model and reasoning effort from native args without injecting duplicates', () => {
    expect(
      buildHeteroSpawnArgs({
        args: ['-m', 'native-model'],
        model: 'selector-model',
        type: 'qoder',
      }),
    ).toEqual(['-m', 'native-model']);
    expect(
      buildHeteroExecArgs({
        args: ['--model=native-model'],
        model: 'selector-model',
        type: 'qoder',
      }),
    ).toEqual(['--agent-arg=--model=native-model']);
    expect(
      buildHeteroSpawnArgs({
        args: ['--reasoning-effort', 'max'],
        effort: 'high',
        type: 'qoder',
      }),
    ).toEqual(['--reasoning-effort', 'max']);
    expect(
      buildHeteroExecArgs({
        args: ['--reasoning-effort=max'],
        effort: 'high',
        type: 'qoder',
      }),
    ).toEqual(['--agent-arg=--reasoning-effort=max']);
    expect(
      buildHeteroSpawnArgs({
        model: HETEROGENEOUS_AGENT_DEFAULT_SELECTION,
        type: 'qoder',
      }),
    ).toBeUndefined();
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

  it('forwards Pi native args and an explicit provider/model selection', () => {
    const provider = {
      args: ['--offline'],
      effort: 'high',
      model: 'anthropic/claude-sonnet-4-5',
      type: 'pi',
    } satisfies HeterogeneousProviderConfig;

    expect(buildHeteroSpawnArgs(provider)).toEqual([
      '--offline',
      '--model',
      'anthropic/claude-sonnet-4-5',
    ]);
    expect(buildHeteroExecArgs(provider)).toEqual([
      '--agent-arg=--offline',
      '--model',
      'anthropic/claude-sonnet-4-5',
    ]);
  });

  it('does not duplicate a Pi model already present in native args', () => {
    const provider = {
      args: ['--model=google/gemini-2.5-pro'],
      model: 'anthropic/claude-sonnet-4-5',
      type: 'pi',
    } satisfies HeterogeneousProviderConfig;

    expect(buildHeteroSpawnArgs(provider)).toEqual(['--model=google/gemini-2.5-pro']);
    expect(buildHeteroExecArgs(provider)).toEqual(['--agent-arg=--model=google/gemini-2.5-pro']);
  });

  it('appends --model and --effort for claude-code', () => {
    expect(buildHeteroSpawnArgs({ type: 'claude-code', model: 'opus', effort: 'high' })).toEqual([
      '--model',
      'opus',
      '--effort',
      'high',
    ]);
  });

  it('appends CodeBuddy model and effort using its Claude-compatible CLI flags', () => {
    const provider = { effort: 'high', model: 'gpt-5.4', type: 'codebuddy' } as const;

    expect(buildHeteroSpawnArgs(provider)).toEqual(['--model', 'gpt-5.4', '--effort', 'high']);
    expect(buildHeteroExecArgs(provider)).toEqual(['--model', 'gpt-5.4', '--effort', 'high']);
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

  it('uses the model-specific levels supported by custom server-default models', () => {
    expect(getCodexReasoningEffortLevels('deepseek-v4-flash')).toEqual(['low', 'high', 'max']);
    expect(getCodexReasoningEffortLevels('deepseek-v4-pro')).toEqual(['low', 'high', 'max']);
    expect(getCodexReasoningEffortLevels('glm-5.2')).toEqual(['high', 'max']);
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
  it('normalizes a legacy persisted heterogeneous provider before applying overrides', () => {
    const shared = {
      executionTarget: 'device',
      heterogeneousProvider: { command: 'codex' },
    } as unknown as Parameters<typeof resolveAgencyConfig>[0];

    expect(resolveAgencyConfig(shared, { executionTarget: 'local' })).toEqual({
      executionTarget: 'local',
      heterogeneousProvider: { command: 'codex', type: 'codex' },
    });
  });

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

  // A `local` / this-machine pick is per-user even for the owner: the shared
  // row must never reference a personal device (the server rejects it), so the
  // owner's pick lives in the same override slot members use and must merge
  // back at read time — bypassing `fixed`, which constrains members only.
  it("applies the owner's own override on a private Workspace Agent, stripping the member policy", () => {
    expect(
      resolveAgentAgencyConfig(
        {
          boundDeviceId: 'shared-device',
          executionTarget: 'device',
          executionTargetSelectionPolicy: 'fixed',
        },
        { boundDeviceId: 'owner-desktop', executionTarget: 'local' },
        { visibility: 'private', workspaceId: 'workspace-1' },
      ),
    ).toEqual({ boundDeviceId: 'owner-desktop', executionTarget: 'local' });
  });

  it("applies an author's or Workspace admin's own override on a public Workspace Agent", () => {
    expect(
      resolveAgentAgencyConfig(
        {
          boundDeviceId: 'shared-device',
          executionTarget: 'device',
          executionTargetSelectionPolicy: 'fixed',
        },
        { boundDeviceId: 'manager-desktop', executionTarget: 'local' },
        { canManage: true, visibility: 'public', workspaceId: 'workspace-1' },
      ),
    ).toEqual({ boundDeviceId: 'manager-desktop', executionTarget: 'local' });
  });

  it('keeps the shared config (policy stripped) for an owner without an override', () => {
    expect(
      resolveAgentAgencyConfig(
        {
          boundDeviceId: 'shared-device',
          executionTarget: 'device',
          executionTargetSelectionPolicy: 'fixed',
        },
        undefined,
        { canManage: true, visibility: 'public', workspaceId: 'workspace-1' },
      ),
    ).toEqual({ boundDeviceId: 'shared-device', executionTarget: 'device' });
  });

  it('never applies an override on a personal agent', () => {
    expect(
      resolveAgentAgencyConfig(
        { executionTarget: 'sandbox' },
        { boundDeviceId: 'stale-device', executionTarget: 'local' },
        { workspaceId: null },
      ),
    ).toEqual({ executionTarget: 'sandbox' });
  });
});

describe('resolveAgentTopicSharePolicy', () => {
  it('never restricts a personal agent — there is nobody to restrict', () => {
    expect(
      resolveAgentTopicSharePolicy({
        agencyConfig: { topicSharePolicy: 'restricted' },
        workspaceId: null,
      }),
    ).toBe('member');
  });

  it('keeps legacy workspace rows on the behaviour they were created with', () => {
    expect(resolveAgentTopicSharePolicy({ workspaceId: 'workspace-1' })).toBe('member');
    expect(resolveAgentTopicSharePolicy({ agencyConfig: {}, workspaceId: 'workspace-1' })).toBe(
      'member',
    );
  });

  it('honours an explicit restriction on a workspace agent', () => {
    expect(
      resolveAgentTopicSharePolicy({
        agencyConfig: { topicSharePolicy: 'restricted' },
        workspaceId: 'workspace-1',
      }),
    ).toBe('restricted');
  });
});

describe('canPublishAgentTopicLink', () => {
  const restricted = {
    agencyConfig: { topicSharePolicy: 'restricted' as const },
    userId: 'author',
    workspaceId: 'workspace-1',
  };

  it('falls back to the role gate when no agent resolved', () => {
    // Legacy session-only topics, or a row the caller cannot read: there is no
    // policy to apply, so this must not become a second, silent denial.
    expect(canPublishAgentTopicLink(undefined, { userId: 'member' })).toBe(true);
    expect(canPublishAgentTopicLink(null, { userId: 'member' })).toBe(true);
  });

  it('blocks a plain member on a restricted agent', () => {
    expect(canPublishAgentTopicLink(restricted, { userId: 'member' })).toBe(false);
  });

  it('lets the agent author and workspace owners through', () => {
    expect(canPublishAgentTopicLink(restricted, { userId: 'author' })).toBe(true);
    expect(canPublishAgentTopicLink(restricted, { isWorkspaceOwner: true, userId: 'member' })).toBe(
      true,
    );
  });

  it('does not match an author against a missing viewer id', () => {
    expect(canPublishAgentTopicLink({ ...restricted, userId: null }, { userId: undefined })).toBe(
      false,
    );
  });
});
