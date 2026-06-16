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
  useFleetStore.setState({ columns: [], dismissedKeys: [], rowByKey: {}, rows: 1, widths: {} });
  localStorage.clear();
});

describe('fleet store', () => {
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

  it('removeColumn marks the key dismissed so it is not auto re-added', () => {
    useFleetStore.setState({ columns: [col('a')] });
    useFleetStore.getState().removeColumn('a');
    expect(useFleetStore.getState().dismissedKeys).toEqual(['a']);
  });

  it('addColumn clears a prior dismissal so a re-pinned column sticks', () => {
    useFleetStore.setState({ columns: [], dismissedKeys: ['a'] });
    useFleetStore.getState().addColumn(col('a'));
    expect(useFleetStore.getState().columns.map((c) => c.key)).toEqual(['a']);
    expect(useFleetStore.getState().dismissedKeys).toEqual([]);
  });

  describe('syncRunningColumns', () => {
    it('appends newly-running columns the board does not have yet', () => {
      useFleetStore.setState({ columns: [col('a')] });
      useFleetStore.getState().syncRunningColumns([col('a'), col('b')]);
      expect(useFleetStore.getState().columns.map((c) => c.key)).toEqual(['a', 'b']);
    });

    it('never reorders or removes existing columns (manual pins preserved)', () => {
      useFleetStore.setState({ columns: [col('manual'), col('a')] });
      // 'manual' is not in the running set, 'b' is new.
      useFleetStore.getState().syncRunningColumns([col('a'), col('b')]);
      expect(useFleetStore.getState().columns.map((c) => c.key)).toEqual(['manual', 'a', 'b']);
    });

    it('does not re-add a column the user closed while it is still running', () => {
      useFleetStore.setState({ columns: [col('a')] });
      useFleetStore.getState().removeColumn('a'); // close while running
      useFleetStore.getState().syncRunningColumns([col('a')]); // still running
      expect(useFleetStore.getState().columns).toEqual([]);
      expect(useFleetStore.getState().dismissedKeys).toEqual(['a']);
    });

    it('clears dismissal once the topic stops, so a fresh run re-surfaces it', () => {
      useFleetStore.setState({ columns: [], dismissedKeys: ['a'] });
      useFleetStore.getState().syncRunningColumns([]); // 'a' no longer running
      expect(useFleetStore.getState().dismissedKeys).toEqual([]);
      useFleetStore.getState().syncRunningColumns([col('a')]); // runs again
      expect(useFleetStore.getState().columns.map((c) => c.key)).toEqual(['a']);
    });
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

  describe('multi-row bands', () => {
    it('setRows spreads columns evenly across the new band count', () => {
      useFleetStore.setState({ columns: [col('a'), col('b'), col('c'), col('d')] });
      useFleetStore.getState().setRows(2);
      expect(useFleetStore.getState().rows).toBe(2);
      expect(useFleetStore.getState().rowByKey).toEqual({ a: 0, b: 0, c: 1, d: 1 });
    });

    it('setRows gives the leading band the spare when columns are odd', () => {
      useFleetStore.setState({ columns: [col('a'), col('b'), col('c')] });
      useFleetStore.getState().setRows(2); // 3 cols / 2 rows → 2,1
      expect(useFleetStore.getState().rowByKey).toEqual({ a: 0, b: 0, c: 1 });
    });

    it('moveColumn re-bands only the dragged column — other bands never reflow', () => {
      useFleetStore.setState({
        columns: [col('a'), col('b'), col('c'), col('d')],
        rowByKey: { a: 0, b: 0, c: 1, d: 1 },
        rows: 2,
      });
      // Drag 'a' (row 0) onto 'c' (row 1): 'a' joins row 1 at c's slot.
      useFleetStore.getState().moveColumn('a', 'c', 1);
      const s = useFleetStore.getState();
      // c and d stay in row 1 (no wrap); only 'a' changed band.
      expect(s.rowByKey).toEqual({ a: 1, b: 0, c: 1, d: 1 });
      // Flat order: 'a' spliced to c's index → b, a, c, d.
      expect(s.columns.map((c) => c.key)).toEqual(['b', 'a', 'c', 'd']);
    });

    it('moveColumn clamps the target band to the current row count', () => {
      useFleetStore.setState({ columns: [col('a'), col('b')], rowByKey: { a: 0, b: 1 }, rows: 2 });
      useFleetStore.getState().moveColumn('a', null, 5); // out-of-range row
      expect(useFleetStore.getState().rowByKey.a).toBe(1);
    });
  });

  // localStorage persistence is covered end-to-end (reload restores width);
  // here we only assert the in-state width bookkeeping.
  it('setWidth records a per-column width', () => {
    useFleetStore.getState().setWidth('a', 540);
    expect(useFleetStore.getState().widths.a).toBe(540);
  });
});
