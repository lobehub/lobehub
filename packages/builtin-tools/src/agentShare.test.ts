import { describe, expect, it } from 'vitest';

import { getShareAgentEnabledToolIds, getShareTurnedOffToolIds } from './agentShare';

describe('getShareTurnedOffToolIds', () => {
  it('adds memory and web browsing when chatConfig switches them off', () => {
    expect(
      getShareTurnedOffToolIds({
        chatConfig: { memory: { enabled: false }, searchMode: 'off' },
        plugins: [{ identifier: 'mcp-x', mode: 'disabled' }],
      }),
    ).toEqual(['mcp-x', 'lobe-user-memory', 'lobe-web-browsing']);
  });

  it('keeps web browsing on when no search mode is stored', () => {
    expect(getShareTurnedOffToolIds({ chatConfig: { memory: { enabled: true } } })).toEqual([]);
  });
});

describe('getShareAgentEnabledToolIds', () => {
  it('counts pinned plugins, runtime-managed tools and on-demand builtins in agent mode', () => {
    const ids = getShareAgentEnabledToolIds({
      chatConfig: { memory: { enabled: true } },
      plugins: ['mcp-pinned'],
    });

    expect(ids).toEqual(
      expect.arrayContaining([
        'mcp-pinned',
        'lobe-web-browsing',
        'lobe-user-memory',
        'lobe-calculator',
        'lobe-image-generation',
      ]),
    );
  });

  it('counts an opted-in extension only in agent mode with automatic activation', () => {
    const plugins = [{ identifier: 'mcp-auto', mode: 'auto' as const }];

    expect(getShareAgentEnabledToolIds({ plugins })).toContain('mcp-auto');
    expect(
      getShareAgentEnabledToolIds({ chatConfig: { skillActivateMode: 'manual' }, plugins }),
    ).not.toContain('mcp-auto');
    expect(
      getShareAgentEnabledToolIds({ chatConfig: { toolMode: 'chat' }, plugins }),
    ).not.toContain('lobe-calculator');
  });

  it('limits extensions to the activatable list when one is given', () => {
    expect(
      getShareAgentEnabledToolIds({
        activatableExtensionIds: [],
        plugins: [{ identifier: 'mcp-auto', mode: 'auto' }],
      }),
    ).not.toContain('mcp-auto');
  });

  it('counts a connected extension the Agent has no entry for, as its tools page does', () => {
    const ids = getShareAgentEnabledToolIds({
      activatableExtensionIds: ['mcp-connected', 'mcp-off'],
      plugins: [{ identifier: 'mcp-off', mode: 'disabled' }],
    });

    expect(ids).toContain('mcp-connected');
    expect(ids).not.toContain('mcp-off');
    expect(
      getShareAgentEnabledToolIds({
        activatableExtensionIds: ['mcp-connected'],
        chatConfig: { skillActivateMode: 'manual' },
      }),
    ).not.toContain('mcp-connected');
  });

  it('drops what the Agent turned off, skills and tools visitors can never use', () => {
    const ids = getShareAgentEnabledToolIds({
      chatConfig: { searchMode: 'off' },
      plugins: [
        { identifier: 'lobe-calculator', mode: 'disabled' },
        'skill-pinned',
        'lobe-local-system',
      ],
      skillIds: ['skill-pinned'],
    });

    expect(ids).not.toContain('lobe-calculator');
    expect(ids).not.toContain('lobe-web-browsing');
    expect(ids).not.toContain('lobe-user-memory');
    expect(ids).not.toContain('skill-pinned');
    expect(ids).not.toContain('lobe-local-system');
  });
});
