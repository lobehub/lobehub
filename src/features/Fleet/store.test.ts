import { beforeEach, describe, expect, it } from 'vitest';

import { useFleetStore } from './store';
import { type FleetColumn } from './types';

const col = (key: string): FleetColumn => ({
  agentId: 'agt',
  fallbackTitle: key,
  key,
  threadId: null,
  topicId: key,
});

beforeEach(() => {
  useFleetStore.setState({ columns: [], seeded: false, widths: {} });
  localStorage.clear();
});

describe('fleet store', () => {
  it('seedColumns seeds once, then no-ops', () => {
    const { seedColumns } = useFleetStore.getState();
    seedColumns([col('a'), col('b')]);
    expect(useFleetStore.getState().columns.map((c) => c.key)).toEqual(['a', 'b']);
    expect(useFleetStore.getState().seeded).toBe(true);

    // second seed is ignored — user customisations within a session win
    seedColumns([col('c')]);
    expect(useFleetStore.getState().columns.map((c) => c.key)).toEqual(['a', 'b']);
  });

  it('addColumn appends and dedupes by key', () => {
    const s = useFleetStore.getState();
    s.addColumn(col('a'));
    s.addColumn(col('b'));
    s.addColumn(col('a')); // duplicate → ignored
    expect(useFleetStore.getState().columns.map((c) => c.key)).toEqual(['a', 'b']);
  });

  it('removeColumn drops the matching key', () => {
    useFleetStore.setState({ columns: [col('a'), col('b'), col('c')] });
    useFleetStore.getState().removeColumn('b');
    expect(useFleetStore.getState().columns.map((c) => c.key)).toEqual(['a', 'c']);
  });

  it('reorderColumns applies the given key order (drag-and-drop result)', () => {
    useFleetStore.setState({ columns: [col('a'), col('b'), col('c')] });
    useFleetStore.getState().reorderColumns(['c', 'a', 'b']);
    expect(useFleetStore.getState().columns.map((c) => c.key)).toEqual(['c', 'a', 'b']);
  });

  it('reorderColumns keeps columns absent from the order list at the end', () => {
    useFleetStore.setState({ columns: [col('a'), col('b'), col('c')] });
    useFleetStore.getState().reorderColumns(['b', 'a']); // 'c' omitted
    expect(useFleetStore.getState().columns.map((c) => c.key)).toEqual(['b', 'a', 'c']);
  });

  // localStorage persistence is covered end-to-end (reload restores width);
  // here we only assert the in-state width bookkeeping.
  it('setWidth records a per-column width', () => {
    useFleetStore.getState().setWidth('a', 540);
    expect(useFleetStore.getState().widths.a).toBe(540);
  });
});
