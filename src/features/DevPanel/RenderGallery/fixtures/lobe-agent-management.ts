'use client';

import { defineFixtures, single } from './_helpers';

export default defineFixtures({
  identifier: 'lobe-agent-management',
  fixtures: {
    callAgent: single({
      args: {
        agentId: 'agent_workspace_helper',
        instruction:
          'Review the `/devtools` route and list any preview cards that still need richer fixtures.',
      },
    }),
    createAgent: single({
      args: {
        description: 'Internal helper for preview and QA workflows.',
        model: 'gpt-5.4',
        plugins: ['lobe-web-browsing', 'lobe-local-system'],
        provider: 'openai',
        systemRole: 'You help engineers verify UI changes quickly and carefully.',
        title: 'Preview QA Agent',
      },
    }),
    duplicateAgent: single({
      args: {
        agentId: 'agent_workspace_helper',
        newTitle: 'Workspace Helper Copy',
      },
      pluginState: {
        newAgentId: 'agent_preview_clone',
        sourceAgentId: 'agent_workspace_helper',
        success: true,
      },
    }),
    getAgentDetail: single({
      args: {
        agentId: 'agent_preview_specialist',
      },
      pluginState: {
        config: {
          model: 'gpt-5.4',
          plugins: ['lobe-web-browsing', 'lobe-cloud-sandbox'],
          provider: 'openai',
          systemRole: 'Focus on frontend verification and fast local feedback loops.',
        },
        meta: {
          avatar: '🧪',
          backgroundColor: '#EEF6FF',
          description: 'Specialized in preview harnesses and UI regression checks.',
          tags: ['preview', 'qa'],
          title: 'Preview Specialist',
        },
      },
    }),
    installPlugin: single({
      args: {
        agentId: 'agent_preview_specialist',
        identifier: 'lobe-cloud-sandbox',
        source: 'official',
      },
      pluginState: {
        installed: true,
        pluginId: 'lobe-cloud-sandbox',
        pluginName: 'Cloud Sandbox',
      },
    }),
    searchAgent: single({
      args: {
        keyword: 'preview',
        source: 'all',
      },
      pluginState: {
        agents: [
          {
            avatar: '🧪',
            backgroundColor: '#EEF6FF',
            description: 'Preview route and fixture maintainer.',
            id: 'agent_preview_specialist',
            isMarket: false,
            title: 'Preview Specialist',
          },
          {
            avatar: '📚',
            backgroundColor: '#FFF7E8',
            description: 'Keeps internal docs and issue writeups tidy.',
            id: 'agent_doc_partner',
            isMarket: true,
            title: 'Documentation Partner',
          },
        ],
      },
    }),
    updateAgent: single({
      args: {
        agentId: 'agent_preview_specialist',
        config: JSON.stringify({
          model: 'gpt-5.4',
          systemRole: 'Prioritize maintainable developer tooling and preview coverage.',
        }),
        meta: JSON.stringify({
          description: 'Expanded to cover internal tooling previews.',
          title: 'Workspace Preview Partner',
        }),
      },
    }),
    updatePrompt: single({
      args: {
        agentId: 'agent_preview_specialist',
        prompt:
          'When asked for a visual check, prefer building a reusable preview harness before taking a screenshot.',
      },
    }),
  },
});
