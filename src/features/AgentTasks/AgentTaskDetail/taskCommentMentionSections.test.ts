import { describe, expect, it } from 'vitest';

import { createTaskCommentMentionSections } from './taskCommentMentionSections';

const labels = { agents: 'Agents', members: 'Members' };

describe('createTaskCommentMentionSections', () => {
  it('offers agents in a personal workspace, which has no members', () => {
    const sections = createTaskCommentMentionSections({
      agents: [{ id: 'agt_sienna', title: 'Sienna' }],
      labels,
      members: [],
      unnamedAgent: 'Untitled Agent',
    });

    expect(sections.map((section) => section.label)).toEqual(['Agents']);
    expect(sections[0].items[0]).toMatchObject({
      label: 'Sienna',
      metadata: { id: 'agt_sienna', type: 'agent' },
    });
  });

  it('lists members before agents, each once', () => {
    const sections = createTaskCommentMentionSections({
      agents: [
        { id: 'agt_codex', title: 'Codex' },
        { id: 'agt_codex', title: 'Codex' },
      ],
      labels,
      members: [{ user: { fullName: 'Lin' }, userId: 'user_lin' }],
      unnamedAgent: 'Untitled Agent',
    });

    expect(sections.map((section) => section.label)).toEqual(['Members', 'Agents']);
    expect(sections[0].items[0].metadata).toMatchObject({ id: 'user_lin', type: 'member' });
    expect(sections[1].items).toHaveLength(1);
  });
});
