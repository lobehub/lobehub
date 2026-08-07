import { describe, expect, it } from 'vitest';

import {
  buildHeterogeneousAgentAuthRequiredError,
  getHeterogeneousAgentConfig,
  HETEROGENEOUS_AGENT_CONFIGS,
  isHeterogeneousAgentAuthRequired,
  isRemoteHeterogeneousType,
  resolveHeterogeneousAgentCommand,
} from './config';
import { getHeterogeneousTypeLabel, HETEROGENEOUS_TYPE_LABELS } from './labels';

describe('heterogeneous agent config', () => {
  it('defines create config for all registered agent types', () => {
    expect(HETEROGENEOUS_AGENT_CONFIGS.map((config) => config.type)).toEqual([
      'amp',
      'claude-code',
      'codex',
      'opencode',
      'pi',
      'qoder',
    ]);
  });

  it('resolves descriptor metadata by type', () => {
    expect(getHeterogeneousAgentConfig('claude-code')).toMatchObject({
      defaultCommand: 'claude',
      install: {
        docsUrl: 'https://docs.anthropic.com/en/docs/claude-code/setup',
      },
      kind: 'local-cli',
      title: 'Claude Code',
      type: 'claude-code',
    });
    expect(getHeterogeneousAgentConfig('codex')).toMatchObject({
      defaultCommand: 'codex',
      title: 'Codex',
      type: 'codex',
    });
    expect(getHeterogeneousAgentConfig('amp')).toMatchObject({
      defaultCommand: 'amp',
      title: 'Amp',
      type: 'amp',
    });
    expect(getHeterogeneousAgentConfig('opencode')).toMatchObject({
      defaultCommand: 'opencode',
      title: 'OpenCode',
      type: 'opencode',
    });
    expect(getHeterogeneousAgentConfig('pi')).toMatchObject({
      defaultCommand: 'pi',
      title: 'Pi',
      type: 'pi',
    });
    expect(getHeterogeneousAgentConfig('qoder')).toMatchObject({
      auth: { docsUrl: 'https://docs.qoder.com/cli/auth.md' },
      defaultCommand: 'qodercli',
      title: 'Qoder',
      type: 'qoder',
    });
  });

  it('resolves commands from descriptors and fails loudly for unknown types', () => {
    expect(resolveHeterogeneousAgentCommand('claude-code')).toBe('claude');
    expect(resolveHeterogeneousAgentCommand('claude-code', ' claude-beta ')).toBe('claude-beta');
    expect(() => resolveHeterogeneousAgentCommand('unknown-agent')).toThrow(
      'Unknown local heterogeneous agent type: "unknown-agent"',
    );
  });

  it('builds auth guidance from descriptor metadata', () => {
    expect(isHeterogeneousAgentAuthRequired('amp', 'Please log in before continuing')).toBe(true);
    expect(buildHeterogeneousAgentAuthRequiredError({ agentType: 'amp' })).toMatchObject({
      agentType: 'amp',
      code: 'auth_required',
      command: 'amp',
      docsUrl: 'https://ampcode.com/manual',
      message: 'Amp could not authenticate. Run `amp login` or configure AMP_API_KEY, then retry.',
    });
  });

  it('derives display labels from the shared config source', () => {
    expect(HETEROGENEOUS_TYPE_LABELS).toEqual({
      'amp': 'Amp',
      'claude-code': 'Claude Code',
      'codex': 'Codex',
      'hermes': 'Hermes',
      'openclaw': 'OpenClaw',
      'opencode': 'OpenCode',
      'pi': 'Pi',
      'qoder': 'Qoder',
    });
  });

  it('resolves display labels with safe fallbacks', () => {
    expect(getHeterogeneousTypeLabel('hermes')).toBe('Hermes');
    expect(getHeterogeneousTypeLabel('future-runtime')).toBe('future-runtime');
    expect(getHeterogeneousTypeLabel('toString')).toBe('toString');
    expect(getHeterogeneousTypeLabel(null)).toBeUndefined();
    expect(getHeterogeneousTypeLabel()).toBeUndefined();
  });

  it('classifies local CLIs separately from remote platforms', () => {
    expect(isRemoteHeterogeneousType('amp')).toBe(false);
    expect(isRemoteHeterogeneousType('opencode')).toBe(false);
    expect(isRemoteHeterogeneousType('pi')).toBe(false);
    expect(isRemoteHeterogeneousType('qoder')).toBe(false);
    expect(isRemoteHeterogeneousType('openclaw')).toBe(true);
    expect(isRemoteHeterogeneousType('hermes')).toBe(true);
  });
});
