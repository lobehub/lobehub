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

  it('points hand-off messages at Channels only when the run can message them', () => {
    const rule = '`listChannels`, then `sendMessage`';
    expect(buildProjectContextPrompt({ ...input, currentAgentId: 'agt_coord' })).not.toContain(
      rule,
    );
    const prompt = buildProjectContextPrompt({
      ...input,
      channelMessaging: true,
      currentAgentId: 'agt_coord',
    });
    expect(prompt).toContain(rule);
    expect(prompt.indexOf(rule)).toBeLessThan(prompt.indexOf('</coordination_rules>'));
  });

  it('marks a member agent and leaves the coordination rules out', () => {
    const prompt = buildProjectContextPrompt({ ...input, currentAgentId: 'agt_writer' });

    expect(prompt).toContain('Writer (agt_writer): copywriter — Drafts copy [you]');
    expect(prompt).toContain('Coordinator (agt_coord): coordinator — Leads the launch');
    expect(prompt).not.toContain('<coordination_rules>');
  });

  it('introduces a named member by its name with its role behind it', () => {
    const prompt = buildProjectContextPrompt({
      ...input,
      currentAgentId: 'agt_writer',
      members: [
        ...input.members.filter(({ agentId }) => agentId !== 'agt_writer'),
        { agentId: 'agt_writer', name: 'Justin', role: 'copywriter', title: 'Writer' },
      ],
      openTasks: [
        { assigneeAgentId: 'agt_writer', identifier: 'APO-2', priority: 2, status: 'running' },
      ],
    });

    expect(prompt).toContain('Justin (Writer) (agt_writer): copywriter [you]');
    // An assigned task names the same agent the roster does.
    expect(prompt).toContain('— Justin (Writer) (agt_writer)');
    expect(prompt).not.toMatch(/- Writer \(agt_writer\)/);
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

  it('lists the runners in priority order and the environment they prepare', () => {
    const prompt = buildProjectContextPrompt({
      ...input,
      currentAgentId: 'agt_coord',
      environment: {
        bootstrapCommand: 'pnpm install',
        envNames: ['REGION'],
        notes: 'dev needs 8 GB of memory',
        repositories: [
          { ref: 'main', setupCommand: 'pnpm i', url: 'https://github.com/lobehub/lobe-pet' },
        ],
      },
      runners: [
        {
          kind: 'device',
          name: 'Mac Pro',
          online: true,
          path: '/Users/lin/code',
          platform: 'darwin',
        },
        { kind: 'sandbox' },
        { kind: 'device', name: 'Lin-PC', path: 'C:\\code' },
      ],
    });

    expect(prompt).toContain(
      '  1. Device "Mac Pro" (darwin, online) — workspace folder: /Users/lin/code',
    );
    expect(prompt).toMatch(/ {2}2\. Cloud sandbox/);
    expect(prompt).toContain('3. Device "Lin-PC" (presence unknown)');
    expect(prompt).toContain('    - https://github.com/lobehub/lobe-pet (ref main; setup: pnpm i)');
    expect(prompt).toContain('<setup>pnpm install</setup>');
    expect(prompt).toContain('<variables only_in="cloud sandbox">REGION</variables>');
    expect(prompt).toContain('dev needs 8 GB of memory');
  });

  it('never puts a variable value into the prompt', () => {
    const prompt = buildProjectContextPrompt({
      ...input,
      currentAgentId: 'agt_coord',
      environment: { envNames: ['API_TOKEN'], repositories: [] },
    });

    expect(prompt).toContain('<variables only_in="cloud sandbox">API_TOKEN</variables>');
    expect(prompt).not.toContain('API_TOKEN=');
  });

  it('leaves runners and environment out when there is nothing to say', () => {
    const prompt = buildProjectContextPrompt({
      ...input,
      currentAgentId: 'agt_coord',
      environment: { repositories: [] },
      runners: [],
    });

    expect(prompt).not.toContain('<runners');
    expect(prompt).not.toContain('<environment');
  });
});
