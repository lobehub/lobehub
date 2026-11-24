import { LobeActivatorIdentifier } from '@lobechat/builtin-tool-activator';
import type { LobeToolManifest } from '@lobechat/context-engine';
import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { contextEngineering } from './contextEngineering';

vi.mock('@/helpers/parserPlaceholder', () => ({
  HOST_VARIABLE_GENERATORS: {
    random: () => '12345',
    username: () => 'TestUser',
  },
}));

describe('contextEngineering tool discovery stability', () => {
  const discoveryManifests: Record<string, LobeToolManifest> = {
    [LobeActivatorIdentifier]: {
      api: [{ description: 'Activate tools', name: 'activateTools', parameters: {} }],
      identifier: LobeActivatorIdentifier,
      meta: { description: 'Activate tools', title: 'Activator' },
      type: 'builtin',
    },
    'lobe-web-browsing': {
      api: [{ description: 'Crawl a page', name: 'crawlSinglePage', parameters: {} }],
      identifier: 'lobe-web-browsing',
      meta: { description: 'Search and crawl web pages', title: 'Web Browsing' },
      type: 'builtin',
    },
    'lobe-notebook': {
      api: [{ description: 'Create note', name: 'createDocument', parameters: {} }],
      identifier: 'lobe-notebook',
      meta: { description: 'Manage notes', title: 'Notebook' },
      type: 'builtin',
    },
  };

  const baseMessages: UIChatMessage[] = [
    {
      content: 'Check this link',
      createdAt: 1_700_000_000_000,
      id: 'msg-1',
      role: 'user',
      updatedAt: 1_700_000_000_000,
    } as UIChatMessage,
  ];

  it('keeps <available_tools> unchanged mid-operation when discoveryExcludedToolIds stays anchored', async () => {
    const before = await contextEngineering({
      discoveryExcludedToolIds: [LobeActivatorIdentifier],
      discoveryManifests,
      messages: baseMessages,
      model: 'gpt-4o',
      provider: 'openai',
      tools: [LobeActivatorIdentifier],
    });

    const after = await contextEngineering({
      discoveryExcludedToolIds: [LobeActivatorIdentifier],
      discoveryManifests,
      messages: baseMessages,
      model: 'gpt-4o',
      provider: 'openai',
      tools: [LobeActivatorIdentifier, 'lobe-web-browsing'],
    });

    const beforeInjected = before.find(
      (m) =>
        m.role === 'user' &&
        typeof m.content === 'string' &&
        m.content.includes('<available_tools'),
    );
    const afterInjected = after.find(
      (m) =>
        m.role === 'user' &&
        typeof m.content === 'string' &&
        m.content.includes('<available_tools'),
    );

    expect(beforeInjected?.content).toContain('lobe-web-browsing');
    expect(afterInjected?.content).toBe(beforeInjected?.content);
  });
});
