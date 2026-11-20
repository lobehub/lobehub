import { describe, expect, it } from 'vitest';

import { toContextPlans } from '../service';

describe('toContextPlans', () => {
  it('keeps only members of this batch, files each memory once and validates existing ids', () => {
    const { placed, plans } = toContextPlans(
      {
        contexts: [
          {
            dossiers: [
              {
                existing_dossier: 'dos_known',
                members: ['a', 'b', 'outside'],
                now: 'n1',
                title: 'Scheduler',
              },
              { existing_dossier: 'dos_made_up', members: ['b', 'c'], now: 'n2', title: 'Panel' },
              { existing_dossier: '', members: ['outside'], now: '', title: 'Empty' },
            ],
            existing_context: 'ctx_made_up',
            next_steps: ['ship'],
            now: 'live',
            open_questions: [],
            title: 'Task system',
          },
          // Malformed entries from a non-strict provider are skipped, not thrown on.
          null as never,
        ],
        unplaced: [],
      },
      new Set(['a', 'b', 'c']),
      new Set(['ctx_known']),
      new Set(['dos_known']),
    );

    expect([...placed].sort()).toEqual(['a', 'b', 'c']);
    expect(plans).toHaveLength(1);
    expect(plans[0].existingContextId).toBeUndefined();
    expect(plans[0].dossiers).toEqual([
      { existingDossierId: 'dos_known', memberIds: ['a', 'b'], now: 'n1', title: 'Scheduler' },
      { existingDossierId: undefined, memberIds: ['c'], now: 'n2', title: 'Panel' },
    ]);
  });

  it('files a repeated evidence id only once inside one dossier', () => {
    const { placed, plans } = toContextPlans(
      {
        contexts: [
          {
            dossiers: [{ existing_dossier: '', members: ['a', 'a', 'b'], now: 'n1', title: 'One' }],
            existing_context: '',
            next_steps: [],
            now: 'live',
            open_questions: [],
            title: 'Task system',
          },
        ],
        unplaced: [],
      },
      new Set(['a', 'b']),
      new Set(),
      new Set(),
    );

    expect([...placed].sort()).toEqual(['a', 'b']);
    expect(plans[0].dossiers[0].memberIds).toEqual(['a', 'b']);
  });
});
