import { describe, expect, it } from 'vitest';

import type { ProjectDetail } from '@/store/project';

import { projectAgentIds, splitByPriority } from './projectAgentOrder';

const member = (id: string, enabled = true) => ({ agent: { id }, binding: { enabled } });

const detail = (coordinatorAgentId: string | null, agents: ReturnType<typeof member>[]) =>
  ({ agents, project: { coordinatorAgentId } }) as unknown as ProjectDetail;

describe('projectAgentIds', () => {
  it('lists the main agent first, then enabled members', () => {
    expect(
      projectAgentIds(detail('main', [member('a'), member('main'), member('off', false)])),
    ).toEqual(['main', 'a']);
  });

  it('is empty without a loaded project', () => {
    expect(projectAgentIds()).toEqual([]);
  });

  it('keeps members when the project has no main agent', () => {
    expect(projectAgentIds(detail(null, [member('a'), member('b')]))).toEqual(['a', 'b']);
  });
});

describe('splitByPriority', () => {
  const candidates = ['x', 'b', 'y', 'a'].map((id) => ({ id }));

  it('puts project Agents first in project order and keeps the rest in place', () => {
    const { others, priority } = splitByPriority(candidates, ['a', 'missing', 'b']);
    expect(priority.map(({ id }) => id)).toEqual(['a', 'b']);
    expect(others.map(({ id }) => id)).toEqual(['x', 'y']);
  });

  it('leaves every candidate in others without priorities', () => {
    expect(splitByPriority(candidates, []).others).toEqual(candidates);
  });
});
