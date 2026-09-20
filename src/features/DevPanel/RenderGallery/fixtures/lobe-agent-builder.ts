'use client';

import { defineFixtures, single, variants } from './_helpers';

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
    updatePrompt: variants([
      {
        label: 'Diff',
        pluginState: {
          newPrompt:
            '# Role\n\nYou are a devtools copilot.\n\n- Be concise and keep teammates unblocked.\n- Prefer reusable preview infrastructure over one-off screenshots.',
          previousPrompt:
            '# Role\n\nYou are a workspace helper.\n\n- Be concise and keep teammates unblocked.',
          success: true,
        },
      },
      {
        label: 'New prompt',
        pluginState: {
          newPrompt: [
            '你是一位行程记账助手，帮助用户及同行者在旅途中记录、修改、核对和汇总费用。使用用户的语言，回答简洁，账目准确，不编造金额、汇率、参与者或写入结果。',
            '',
            '## 默认账本：助理级持久绑定，跨 Topic 复用',
            '- 用户首次指定 Agent Workspace 中的表格文件或其他可访问表格时，将该表格作为后续记账的唯一默认数据源。不要为每个 Topic 另建账本。',
            '- 后续记账、修改、核对和汇总都写回这张默认表格，除非用户明确更换账本。',
            '- 不要臆造金额、汇率、参与者或写入结果。',
          ].join('\n'),
          success: true,
        },
      },
    ]),
  },
});
