'use client';

import { defineFixtures, single } from './_helpers';

export default defineFixtures({
  identifier: 'lobe-group-agent-builder',
  fixtures: {
    batchCreateAgents: single({
      args: {
        agents: [
          {
            avatar: '🧪',
            description: 'Checks render output and local screenshots.',
            title: 'Preview QA',
            tools: ['lobe-web-browsing', 'lobe-cloud-sandbox'],
          },
          {
            avatar: '📝',
            description: 'Writes issue notes and rollout summaries.',
            title: 'Docs Writer',
            tools: ['lobe-notebook'],
          },
        ],
      },
      pluginState: {
        agents: [
          { agentId: 'agent_preview_qa', success: true, title: 'Preview QA' },
          { agentId: 'agent_docs_writer', success: true, title: 'Docs Writer' },
        ],
      },
    }),
    updateAgentPrompt: single({
      pluginState: {
        newPrompt: 'Focus on validating preview fixtures and reporting only concrete UI issues.',
      },
    }),
    updateGroupPrompt: single({
      pluginState: {
        newPrompt: 'Coordinate fixture coverage across agents and avoid overlapping work.',
      },
    }),
  },
});
