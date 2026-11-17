import { WEBHOOK_EVENT_TYPES } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { groupSelection, toggleEvent, toggleGroup, WEBHOOK_EVENT_GROUPS } from './eventGroups';

const runs = WEBHOOK_EVENT_GROUPS.find((group) => group.key === 'runs')!;

describe('webhook event groups', () => {
  it('offers every subscribable event exactly once', () => {
    const grouped = WEBHOOK_EVENT_GROUPS.flatMap((group) => group.events);

    expect([...grouped].sort()).toEqual([...WEBHOOK_EVENT_TYPES].sort());
  });

  it('reports a group as none, some or all selected', () => {
    expect(groupSelection(runs, [])).toBe('none');
    expect(groupSelection(runs, ['run.failed', 'file.parsed'])).toBe('some');
    expect(groupSelection(runs, [...runs.events])).toBe('all');
  });

  it('selects and clears a whole group, keeping the catalog order', () => {
    const selected = toggleGroup(runs, ['file.parsed', 'run.failed'], true);

    expect(selected).toEqual([
      'run.started',
      'run.completed',
      'run.failed',
      'run.intervention_requested',
      'file.parsed',
    ]);
    expect(toggleGroup(runs, selected, false)).toEqual(['file.parsed']);
  });

  it('toggles one event in catalog order', () => {
    expect(toggleEvent('run.started', ['topic.created'], true)).toEqual([
      'run.started',
      'topic.created',
    ]);
    expect(toggleEvent('topic.created', ['run.started', 'topic.created'], false)).toEqual([
      'run.started',
    ]);
  });
});
