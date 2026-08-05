import { describe, expect, it } from 'vitest';

import type { AddContextMemoryParams } from '../../types';
import { getContextMemoryViewModel } from './contextMemoryViewModel';

const asParams = (value: unknown) => value as AddContextMemoryParams;

describe('getContextMemoryViewModel', () => {
  it('derives the card content from a well-formed tool call', () => {
    const vm = getContextMemoryViewModel(
      asParams({
        details: 'Long form notes',
        summary: 'Team is building an agent harness',
        tags: ['agent-harness'],
        title: 'LobeHub Agent Harness exploration',
        withContext: {
          associatedObjects: [
            { extra: '{"repo":"lobehub"}', name: 'LobeHub', type: 'application' },
          ],
          associatedSubjects: [{ extra: null, name: 'Arvin Xu', type: 'person' }],
          currentStatus: 'ongoing',
          description: 'The team focuses on agentic infrastructure this quarter.',
          labels: ['multi-agent'],
          scoreImpact: 0.8,
          scoreUrgency: 0.35,
          type: 'project',
        },
      }),
    );

    expect(vm).toMatchObject({
      contextType: 'project',
      hasContextContent: true,
      impact: 80,
      isEmpty: false,
      labels: ['multi-agent'],
      status: 'ongoing',
      tags: ['agent-harness'],
      urgency: 35,
    });
    // subjects come first, then objects
    expect(vm.entities).toEqual([
      { extra: undefined, name: 'Arvin Xu', type: 'person' },
      { extra: '{"repo":"lobehub"}', name: 'LobeHub', type: 'application' },
    ]);
  });

  it('normalizes scalars sent where arrays are expected', () => {
    const vm = getContextMemoryViewModel(
      asParams({
        summary: 'Summary only',
        tags: 'agent-harness',
        withContext: {
          associatedObjects: null,
          associatedSubjects: 'Arvin Xu',
          description: 'Still renders the narrative.',
          labels: 'multi-agent',
        },
      }),
    );

    expect(vm.tags).toEqual([]);
    expect(vm.labels).toEqual([]);
    expect(vm.entities).toEqual([]);
    expect(vm.hasContextContent).toBe(true);
  });

  it('drops entities without a usable name and metadata that is not a string', () => {
    const vm = getContextMemoryViewModel(
      asParams({
        withContext: {
          associatedSubjects: [
            null,
            'Arvin Xu',
            { name: '', type: 'person' },
            { extra: { repo: 'lobehub' }, name: 'Arvin Xu', type: 'person' },
          ],
        },
      }),
    );

    expect(vm.entities).toEqual([{ extra: undefined, name: 'Arvin Xu', type: 'person' }]);
  });

  it('clamps scores into 0-100 and ignores non-numeric ones', () => {
    const vm = getContextMemoryViewModel(
      asParams({ withContext: { scoreImpact: 1.4, scoreUrgency: '0.5' } }),
    );

    expect(vm.impact).toBe(100);
    expect(vm.urgency).toBeUndefined();
    expect(vm.hasContextContent).toBe(true);
  });

  it('falls back to the synthesized headline before the top-level title streams in', () => {
    const vm = getContextMemoryViewModel(
      asParams({ withContext: { title: 'Agent harness', type: 'project' } }),
    );

    expect(vm.title).toBe('Agent harness');
  });

  it('reports an empty view model while arguments are still streaming', () => {
    expect(getContextMemoryViewModel(asParams({})).isEmpty).toBe(true);
    expect(getContextMemoryViewModel(undefined).isEmpty).toBe(true);
    expect(getContextMemoryViewModel(asParams({ title: 'Dirty args' })).isEmpty).toBe(false);
  });
});
