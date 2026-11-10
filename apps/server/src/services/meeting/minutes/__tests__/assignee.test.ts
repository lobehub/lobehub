import { describe, expect, it } from 'vitest';

import { type AssigneeCandidate, matchAssignee } from '../assignee';

const alice: AssigneeCandidate = {
  aliases: ['alice'],
  id: 'u_alice',
  name: 'Alice Chen',
  type: 'user',
};
const alan: AssigneeCandidate = { aliases: ['alan'], id: 'u_alan', name: 'Alan Wu', type: 'user' };
const bob: AssigneeCandidate = { aliases: [], id: 'u_bob', name: '王小明', type: 'user' };
const researcher: AssigneeCandidate = {
  aliases: ['researcher'],
  id: 'agt_research',
  name: 'Research Agent',
  type: 'agent',
};
const candidates = [alice, alan, bob, researcher];
const none = { speakerNames: new Map<string, string>() };

describe('matchAssignee', () => {
  it('matches an exact name or alias case-insensitively', () => {
    expect(matchAssignee('alice chen', candidates, none)).toEqual({
      id: 'u_alice',
      name: 'Alice Chen',
      type: 'user',
    });
    expect(matchAssignee('@Alan', candidates, none)?.id).toBe('u_alan');
    expect(matchAssignee('Research Agent', candidates, none)).toEqual({
      id: 'agt_research',
      name: 'Research Agent',
      type: 'agent',
    });
  });

  it('accepts a partial name only when it points at one candidate', () => {
    expect(matchAssignee('小明', candidates, none)?.id).toBe('u_bob');
    expect(matchAssignee('Alice', candidates, none)?.id).toBe('u_alice');
    // "Al" is part of both Alice and Alan: ambiguous, so it stays unassigned.
    expect(matchAssignee('Al', candidates, none)).toBeUndefined();
  });

  it('leaves unknown and empty owners unassigned', () => {
    expect(matchAssignee('Carol', candidates, none)).toBeUndefined();
    expect(matchAssignee('', candidates, none)).toBeUndefined();
    expect(matchAssignee(undefined, candidates, none)).toBeUndefined();
    expect(matchAssignee('A', candidates, none)).toBeUndefined();
  });

  it('gives first-person commitments to the recorder', () => {
    expect(matchAssignee('我', candidates, { ...none, recorder: bob })?.id).toBe('u_bob');
    expect(matchAssignee('me', candidates, { ...none, recorder: alice })?.id).toBe('u_alice');
    expect(matchAssignee('我', candidates, none)).toBeUndefined();
  });

  it('resolves a diarization label through the name the user gave that speaker', () => {
    const speakerNames = new Map([['Speaker 2', 'Alan Wu']]);
    expect(matchAssignee('Speaker 2', candidates, { speakerNames })?.id).toBe('u_alan');
  });
});
