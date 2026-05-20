'use client';

import { defineFixtures, single } from './_helpers';

export default defineFixtures({
  identifier: 'lobe-agent-builder',
  fixtures: {
    getAvailableModels: single({
      pluginState: {
        providers: [
          {
            id: 'openai',
            models: [
              { abilities: { functionCall: true, reasoning: true, vision: true }, id: 'gpt-5.4' },
              { abilities: { functionCall: true }, id: 'gpt-5.4-mini' },
            ],
            name: 'OpenAI',
          },
          {
            id: 'anthropic',
            models: [{ abilities: { functionCall: true, vision: true }, id: 'claude-sonnet-4' }],
            name: 'Anthropic',
          },
        ],
      },
    }),
    installPlugin: single({
      pluginState: {
        awaitingApproval: false,
        installed: true,
        pluginId: 'lobe-web-browsing',
        pluginName: 'Web Browsing',
        serverStatus: 'active',
      },
    }),
    searchMarketTools: single({
      pluginState: {
        query: 'browser',
        tools: [
          {
            author: 'LobeHub',
            description: 'Search and crawl web pages with configurable engines.',
            icon: '🌐',
            identifier: 'lobe-web-browsing',
            installed: true,
            name: 'Web Browsing',
            tags: ['search', 'crawl'],
          },
          {
            author: 'LobeHub',
            description: 'Run code and inspect local files inside a sandbox.',
            icon: '🧪',
            identifier: 'lobe-cloud-sandbox',
            installed: false,
            name: 'Cloud Sandbox',
            tags: ['files', 'code'],
          },
        ],
        totalCount: 2,
      },
    }),
    updateAgentConfig: single({
      pluginState: {
        config: {
          newValues: { model: 'gpt-5.4', temperature: 0.4 },
          previousValues: { model: 'gpt-5.4-mini', temperature: 0.7 },
          updatedFields: ['model', 'temperature'],
        },
        meta: {
          newValues: {
            description: 'Pairs on internal developer workflows.',
            title: 'Devtools Copilot',
          },
          previousValues: { description: 'General helper.', title: 'Workspace Helper' },
          updatedFields: ['title', 'description'],
        },
        togglePlugin: {
          enabled: true,
          pluginId: 'lobe-web-browsing',
        },
      },
    }),
    updatePrompt: single({
      pluginState: {
        newPrompt:
          'Be concise, keep teammates unblocked, and prefer reusable preview infrastructure over one-off screenshots.',
      },
    }),
  },
});
