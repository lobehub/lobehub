import { describe, expect, it } from 'vitest';

import type { AddActivityMemoryParams } from '../../types';
import { getActivityMemoryViewModel } from './activityMemoryViewModel';

const asParams = (value: unknown) => value as AddActivityMemoryParams;

describe('getActivityMemoryViewModel', () => {
  it('derives the card content from a well-formed tool call', () => {
    const vm = getActivityMemoryViewModel(
      asParams({
        details: 'Agenda: renewal scope, pricing, next steps.',
        summary: 'Client Q2 renewal meeting with Alice',
        tags: ['meeting', 'client'],
        title: 'ACME Q2 renewal meeting',
        withActivity: {
          associatedLocations: [{ address: '123 Main St', name: 'ACME HQ' }],
          associatedObjects: [{ name: 'MacBook', type: 'item' }],
          associatedSubjects: [{ extra: null, name: 'Alice Smith', type: 'person' }],
          endsAt: '2024-05-03T15:00:00-04:00',
          feedback: 'Positive momentum.',
          narrative: 'Alice and User reviewed the Q2 renewal scope.',
          notes: 'Share revised pricing next week.',
          startsAt: '2024-05-03T14:00:00-04:00',
          status: 'completed',
          timezone: 'America/New_York',
          type: 'meeting',
        },
      }),
    );

    expect(vm).toMatchObject({
      activityType: 'meeting',
      feedback: 'Positive momentum.',
      hasActivityContent: true,
      isEmpty: false,
      narrative: 'Alice and User reviewed the Q2 renewal scope.',
      notes: 'Share revised pricing next week.',
      status: 'completed',
      tags: ['meeting', 'client'],
      timezone: 'America/New_York',
    });
    // subjects, then objects, then locations — locations default to the place icon
    expect(vm.entities.map((entity) => [entity.name, entity.type])).toEqual([
      ['Alice Smith', 'person'],
      ['MacBook', 'item'],
      ['ACME HQ', 'place'],
    ]);
  });

  it("reads the schedule in the activity's own timezone, not the viewer's", () => {
    const vm = getActivityMemoryViewModel(
      asParams({
        withActivity: {
          endsAt: '2026-08-03T15:00:00+08:00',
          startsAt: '2026-08-03T14:00:00+08:00',
          timezone: 'Asia/Shanghai',
        },
      }),
    );

    // The card shows the timezone label next to these digits, so they have to come
    // from that same zone — otherwise a 14:00 Shanghai meeting reads as "23:00
    // Asia/Shanghai" for a viewer in America/Los_Angeles.
    expect(vm.schedule).toBe('2026-08-03 14:00 → 15:00');
  });

  it('falls back to the viewer timezone when the activity declares none or an unknown one', () => {
    const unknownZone = getActivityMemoryViewModel(
      asParams({
        withActivity: { startsAt: '2026-08-03T14:00:00+08:00', timezone: 'Mars/Olympus' },
      }),
    );

    // An unusable zone must still produce a readable time rather than throwing.
    expect(unknownZone.schedule).toMatch(/^2026-08-0[23] \d{2}:\d{2}$/);
  });

  it('drops the repeated date when an activity starts and ends the same day', () => {
    const vm = getActivityMemoryViewModel(
      asParams({
        withActivity: {
          endsAt: '2024-05-03T15:00:00Z',
          narrative: 'Met the team.',
          startsAt: '2024-05-03T14:00:00Z',
        },
      }),
    );

    expect(vm.schedule).toMatch(/^2024-05-03 \d{2}:\d{2} → \d{2}:\d{2}$/);
  });

  it('keeps both dates for a multi-day activity', () => {
    const vm = getActivityMemoryViewModel(
      asParams({
        withActivity: { endsAt: '2024-05-07T09:00:00Z', startsAt: '2024-05-03T14:00:00Z' },
      }),
    );

    expect(vm.schedule).toMatch(/^2024-05-03 \d{2}:\d{2} → 2024-05-07 \d{2}:\d{2}$/);
  });

  it('handles a one-sided or unparseable schedule instead of rendering Invalid Date', () => {
    expect(
      getActivityMemoryViewModel(asParams({ withActivity: { startsAt: 'next Tuesday' } })).schedule,
    ).toBe('next Tuesday');

    expect(
      getActivityMemoryViewModel(asParams({ withActivity: { endsAt: '2024-05-03T15:00:00Z' } }))
        .schedule,
    ).toMatch(/^2024-05-03 \d{2}:\d{2}$/);
  });

  it('normalizes scalars sent where arrays are expected', () => {
    const vm = getActivityMemoryViewModel(
      asParams({
        summary: 'Summary only',
        tags: 'meeting',
        withActivity: {
          associatedLocations: null,
          associatedObjects: 'MacBook',
          associatedSubjects: [{ name: '' }, null],
          narrative: 'Still renders the story.',
        },
      }),
    );

    expect(vm.tags).toEqual([]);
    expect(vm.entities).toEqual([]);
    expect(vm.narrative).toBe('Still renders the story.');
    expect(vm.hasActivityContent).toBe(true);
  });

  it('reports an empty view model while arguments are still streaming', () => {
    expect(getActivityMemoryViewModel(asParams({})).isEmpty).toBe(true);
    expect(getActivityMemoryViewModel(undefined).isEmpty).toBe(true);
    expect(getActivityMemoryViewModel(asParams({ title: 'Dinner' })).isEmpty).toBe(false);
  });
});
