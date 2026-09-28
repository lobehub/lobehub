import { PageAgentIdentifier } from '@lobechat/builtin-tool-page-agent';
import { describe, expect, it } from 'vitest';

import { buildMessagesEngineParams } from './buildMessagesEngineParams';
import type { ContextSnapshot } from './types';

const baseSnapshot = (): ContextSnapshot => ({
  agent: { systemRole: 'You are helpful.' },
  model: { model: 'gpt-4', provider: 'openai' },
  run: { messages: [] },
});

describe('buildMessagesEngineParams', () => {
  it('hides the page agent system role unless the run enabled the tool', () => {
    expect(buildMessagesEngineParams(baseSnapshot()).toolsConfig?.disabledToolIdentifiers).toEqual([
      PageAgentIdentifier,
    ]);

    const withPageAgent = buildMessagesEngineParams({
      ...baseSnapshot(),
      tools: { enabledToolIds: [PageAgentIdentifier] },
    });
    expect(withPageAgent.toolsConfig?.disabledToolIdentifiers).toBeUndefined();

    const explicit = buildMessagesEngineParams({
      ...baseSnapshot(),
      tools: { disabledToolIdentifiers: ['x'], enabledToolIds: [] },
    });
    expect(explicit.toolsConfig?.disabledToolIdentifiers).toEqual(['x']);
  });

  it('only sets skills and topic references when there is something to inject', () => {
    const empty = buildMessagesEngineParams({
      ...baseSnapshot(),
      step: { topicReferences: [] },
      tools: { enabledSkills: [] },
    });
    expect(empty).not.toHaveProperty('skillsConfig');
    expect(empty).not.toHaveProperty('topicReferences');

    const filled = buildMessagesEngineParams({
      ...baseSnapshot(),
      step: { topicReferences: [{ id: 't1' } as any] },
      tools: { enabledSkills: [{ identifier: 's1' } as any] },
    });
    expect(filled.skillsConfig).toEqual({ enabledSkills: [{ identifier: 's1' }] });
    expect(filled.topicReferences).toEqual([{ id: 't1' }]);
  });

  it('places world and step facts without leaking undefined keys', () => {
    const params = buildMessagesEngineParams({
      ...baseSnapshot(),
      step: { planTodo: { enabled: true } },
      world: { connectorOwnershipNote: 'note', userTimezone: 'Asia/Shanghai' },
    });

    expect(params.connectorOwnershipNote).toBe('note');
    expect(params.timezone).toBe('Asia/Shanghai');
    expect(params.planTodo).toEqual({ enabled: true });
    expect(params).not.toHaveProperty('agentGroup');
    expect(params).not.toHaveProperty('workspaceContext');
  });

  it('defaults file URLs to the server-safe form and lets the host override', () => {
    expect(buildMessagesEngineParams(baseSnapshot()).fileContext).toEqual({
      enabled: true,
      includeFileUrl: true,
    });
    expect(
      buildMessagesEngineParams({
        ...baseSnapshot(),
        fileContext: { enabled: true, includeFileUrl: false },
      }).fileContext,
    ).toEqual({ enabled: true, includeFileUrl: false });
  });

  it('maps the agent stale-tool-result trim flag through to the engine params', () => {
    expect(buildMessagesEngineParams(baseSnapshot()).enableStaleToolResultTrim).toBeUndefined();

    const disabled = buildMessagesEngineParams({
      ...baseSnapshot(),
      agent: { ...baseSnapshot().agent, enableStaleToolResultTrim: false },
    });
    expect(disabled.enableStaleToolResultTrim).toBe(false);
  });

  it('renders placeholders from the run timezone and lets host variables win', () => {
    const generators = buildMessagesEngineParams({
      ...baseSnapshot(),
      variables: {
        locale: 'zh-CN',
        topic_title: () => 'lazy',
        username: 'arvin',
        workingDirectory: '/repo',
      },
      world: { userTimezone: 'Asia/Tokyo' },
    }).variableGenerators!;

    expect(generators.timezone()).toBe('Asia/Tokyo');
    expect(generators.model()).toBe('gpt-4');
    expect(generators.locale()).toBe('zh-CN');
    expect(generators.username()).toBe('arvin');
    expect(generators.workingDirectory()).toBe('/repo');
    expect(generators.topic_title()).toBe('lazy');
    // Unresolved device placeholders never leak their literal token.
    expect(generators.hostname()).toBe('unknown');
    expect(generators.defaultShell()).not.toContain('{{');
  });
});
