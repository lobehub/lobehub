import { describe, expect, it } from 'vitest';

import {
  buildHeterogeneousAgentAuthRequiredError,
  buildHeterogeneousAgentCliNotFoundError,
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
      'codebuddy',
      'codex',
      'cursor',
      'droid',
      'grok-build',
      'kimi-code',
      'opencode',
      'pi',
      'qoder',
      'trae',
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
    expect(getHeterogeneousAgentConfig('codebuddy')).toMatchObject({
      defaultCommand: 'codebuddy',
      title: 'CodeBuddy',
      type: 'codebuddy',
    });
    expect(getHeterogeneousAgentConfig('cursor')).toMatchObject({
      defaultCommand: 'agent',
      install: { commands: ['curl https://cursor.com/install -fsS | bash'] },
      title: 'Cursor',
      type: 'cursor',
    });
    expect(getHeterogeneousAgentConfig('droid')).toMatchObject({
      auth: { signInCommand: 'droid' },
      defaultCommand: 'droid',
      install: {
        commands: [
          'curl -fsSL https://app.factory.ai/cli | sh',
          'irm https://app.factory.ai/cli/windows | iex',
        ],
      },
      title: 'Factory Droid',
      type: 'droid',
    });
    expect(getHeterogeneousAgentConfig('amp')).toMatchObject({
      defaultCommand: 'amp',
      title: 'Amp',
      type: 'amp',
    });
    expect(getHeterogeneousAgentConfig('grok-build')).toMatchObject({
      auth: { signInCommand: 'grok login' },
      defaultCommand: 'grok',
      title: 'Grok Build',
      type: 'grok-build',
    });
    expect(getHeterogeneousAgentConfig('kimi-code')).toMatchObject({
      defaultCommand: 'kimi',
      title: 'Kimi Code',
      type: 'kimi-code',
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
    expect(getHeterogeneousAgentConfig('trae')).toMatchObject({
      defaultCommand: 'traecli',
      install: {
        commands: [],
        docsUrl: 'https://docs.volcengine.com/docs/86677/2387326?lang=zh',
      },
      title: 'TRAE CLI',
      type: 'trae',
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
    expect(isHeterogeneousAgentAuthRequired('trae', 'Please sign in before continuing')).toBe(true);
    expect(buildHeterogeneousAgentAuthRequiredError({ agentType: 'amp' })).toMatchObject({
      agentType: 'amp',
      code: 'auth_required',
      command: 'amp',
      docsUrl: 'https://ampcode.com/manual',
      message: 'Amp could not authenticate. Run `amp login` or configure AMP_API_KEY, then retry.',
    });
    expect(isHeterogeneousAgentAuthRequired('kimi-code', 'No model configured')).toBe(true);
    expect(buildHeterogeneousAgentAuthRequiredError({ agentType: 'kimi-code' })).toMatchObject({
      agentType: 'kimi-code',
      code: 'auth_required',
      command: 'kimi',
      message: 'Kimi Code could not authenticate. Run `kimi`, use `/login`, then retry.',
    });
    expect(isHeterogeneousAgentAuthRequired('cursor', 'Authentication required')).toBe(true);
    expect(buildHeterogeneousAgentAuthRequiredError({ agentType: 'cursor' })).toMatchObject({
      command: 'agent',
      docsUrl: 'https://cursor.com/docs/cli/installation',
      message: 'Cursor could not authenticate. Run `agent login`, then retry.',
    });
    expect(isHeterogeneousAgentAuthRequired('droid', 'Authentication required')).toBe(true);
    expect(buildHeterogeneousAgentAuthRequiredError({ agentType: 'droid' })).toMatchObject({
      command: 'droid',
      docsUrl: 'https://docs.factory.ai/cli/getting-started/quickstart',
      message:
        'Factory Droid could not authenticate. Run `droid` to sign in or configure FACTORY_API_KEY, then retry.',
    });
  });

  it('builds TRAE CLI installation guidance without duplicating the CLI suffix', () => {
    expect(buildHeterogeneousAgentCliNotFoundError({ agentType: 'trae' })).toMatchObject({
      agentType: 'trae',
      command: 'traecli',
      installCommands: [],
      message: 'TRAE CLI was not found. Install it and make sure `traecli` can be executed.',
    });
  });

  it('derives display labels from the shared config source', () => {
    expect(HETEROGENEOUS_TYPE_LABELS).toEqual({
      'amp': 'Amp',
      'claude-code': 'Claude Code',
      'codebuddy': 'CodeBuddy',
      'codex': 'Codex',
      'cursor': 'Cursor',
      'droid': 'Factory Droid',
      'grok-build': 'Grok Build',
      'hermes': 'Hermes',
      'kimi-code': 'Kimi Code',
      'openclaw': 'OpenClaw',
      'opencode': 'OpenCode',
      'pi': 'Pi',
      'qoder': 'Qoder',
      'trae': 'TRAE CLI',
    });
  });

  it('resolves display labels with safe fallbacks', () => {
    expect(getHeterogeneousTypeLabel('codebuddy')).toBe('CodeBuddy');
    expect(getHeterogeneousTypeLabel('hermes')).toBe('Hermes');
    expect(getHeterogeneousTypeLabel('future-runtime')).toBe('future-runtime');
    expect(getHeterogeneousTypeLabel('toString')).toBe('toString');
    expect(getHeterogeneousTypeLabel(null)).toBeUndefined();
    expect(getHeterogeneousTypeLabel()).toBeUndefined();
  });

  it('classifies local CLIs separately from remote platforms', () => {
    expect(isRemoteHeterogeneousType('amp')).toBe(false);
    expect(isRemoteHeterogeneousType('codebuddy')).toBe(false);
    expect(isRemoteHeterogeneousType('droid')).toBe(false);
    expect(isRemoteHeterogeneousType('opencode')).toBe(false);
    expect(isRemoteHeterogeneousType('pi')).toBe(false);
    expect(isRemoteHeterogeneousType('qoder')).toBe(false);
    expect(isRemoteHeterogeneousType('trae')).toBe(false);
    expect(isRemoteHeterogeneousType('openclaw')).toBe(true);
    expect(isRemoteHeterogeneousType('hermes')).toBe(true);
  });
});
