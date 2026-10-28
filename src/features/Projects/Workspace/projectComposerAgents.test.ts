import { describe, expect, it } from 'vitest';

import { projectComposerAgents } from './projectComposerAgents';

const member = (id: string, enabled = true) => ({
  agent: { avatar: null, backgroundColor: null, id, name: null, title: `Agent ${id}` },
  binding: { enabled },
});

const detail = (coordinatorAgentId: string, agents: ReturnType<typeof member>[]) =>
  ({ agents, project: { coordinatorAgentId } }) as unknown as Parameters<
    typeof projectComposerAgents
  >[0];

describe('projectComposerAgents', () => {
  it('lists the main agent first, then the enabled members', () => {
    const agents = projectComposerAgents(
      detail('main', [member('writer'), member('main'), member('paused', false)]),
    );

    expect(agents.map((agent) => [agent.id, agent.isMain])).toEqual([
      ['main', true],
      ['writer', false],
    ]);
  });

  it('keeps a main agent without a member row, for the store to describe', () => {
    const agents = projectComposerAgents(detail('inbox', [member('writer')]));

    expect(agents[0]).toEqual({ id: 'inbox', isMain: true });
    expect(agents.map((agent) => agent.id)).toEqual(['inbox', 'writer']);
  });
});
