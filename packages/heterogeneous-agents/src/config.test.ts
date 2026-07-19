import { describe, expect, it } from 'vitest';

import {
  getHeterogeneousAgentConfig,
  HETEROGENEOUS_AGENT_CONFIGS,
  isRemoteHeterogeneousType,
} from './config';
import { HETEROGENEOUS_TYPE_LABELS } from './labels';

describe('heterogeneous agent config', () => {
  it('defines create config for all registered agent types', () => {
    expect(HETEROGENEOUS_AGENT_CONFIGS.map((config) => config.type)).toEqual([
      'claude-code',
      'codex',
      'amp',
    ]);
  });

  it('resolves config by type', () => {
    expect(getHeterogeneousAgentConfig('claude-code')).toMatchObject({
      command: 'claude',
      title: 'Claude Code',
      type: 'claude-code',
    });
    expect(getHeterogeneousAgentConfig('codex')).toMatchObject({
      command: 'codex',
      title: 'Codex',
      type: 'codex',
    });
    expect(getHeterogeneousAgentConfig('amp')).toMatchObject({
      command: 'amp',
      title: 'Amp',
      type: 'amp',
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
    });
  });

  it('classifies AMP as a local CLI rather than a remote platform', () => {
    expect(isRemoteHeterogeneousType('amp')).toBe(false);
    expect(isRemoteHeterogeneousType('openclaw')).toBe(true);
  });
});
