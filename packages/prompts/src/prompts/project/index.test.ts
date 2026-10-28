import { describe, expect, it } from 'vitest';

import { buildProjectContextPrompt } from './index';

const input = {
  knowledgeBases: [
    { description: 'Brand voice and tone', id: 'kb_style', name: 'Style guide' },
    { id: 'kb_research', name: 'Research' },
  ],
  members: [
    {
      agentId: 'agt_coord',
      responsibility: 'Leads the launch',
      role: 'coordinator',
      title: 'Coordinator',
    },
    { agentId: 'agt_writer', responsibility: 'Drafts copy', role: 'copywriter', title: 'Writer' },
    { agentId: 'agt_blank', title: null },
  ],
  openTasks: [
    {
      assigneeAgentId: 'agt_writer',
      identifier: 'APO-2',
      name: 'Draft post',
      priority: 2,
      status: 'running',
    },
    { identifier: 'APO-3', name: null, priority: 0, status: 'backlog' },
  ],
  project: {
    coordinatorAgentId: 'agt_coord',
    description: '  Ship the autumn launch  ',
    identifier: 'APO',
    name: 'Apollo',
    status: 'active',
  },
  totalOpenTasks: 5,
};

describe('buildProjectContextPrompt', () => {
  it('gives the coordinator the roster, knowledge, open work and its delegation rules', () => {
    expect(buildProjectContextPrompt({ ...input, currentAgentId: 'agt_coord' })).toMatchSnapshot();
  });

  it('marks a member agent and leaves the coordination rules out', () => {
    const prompt = buildProjectContextPrompt({ ...input, currentAgentId: 'agt_writer' });

    expect(prompt).toContain('Writer (agt_writer): copywriter — Drafts copy [you]');
    expect(prompt).toContain('Coordinator (agt_coord): coordinator — Leads the launch');
    expect(prompt).not.toContain('<coordination_rules>');
  });

  it('leaves the identifier out for a project without its own prefix', () => {
    const prompt = buildProjectContextPrompt({
      ...input,
      currentAgentId: 'agt_coord',
      project: { ...input.project, identifier: null },
    });

    expect(prompt).toContain('<project status="active">Apollo</project>');
    expect(prompt).not.toContain('identifier=');
  });

  it('omits empty knowledge and says there is no open work', () => {
    const prompt = buildProjectContextPrompt({
      ...input,
      currentAgentId: 'agt_coord',
      knowledgeBases: [],
      openTasks: [],
      project: { ...input.project, description: null },
      totalOpenTasks: 0,
    });

    expect(prompt).not.toContain('<knowledge_bases');
    expect(prompt).not.toContain('<description>');
    expect(prompt).toContain('<open_tasks total="0">\n  (none)\n</open_tasks>');
  });
});
