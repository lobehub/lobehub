import { describe, expect, it } from 'vitest';

import type { ReplicaAction, ReplicaViewWrite } from './reducer';
import { createReplicaState, replicaReducer } from './reducer';
import type { ReplicaState } from './types';

type List = string[];

/** Tiny harness: applies view writes to a plain record, like a store lens would. */
const createHarness = (initialView: Record<string, List> = {}) => {
  let state: ReplicaState<List> = createReplicaState();
  let view: Record<string, List> = { ...initialView };
  const effects: unknown[] = [];

  const run = (action: ReplicaAction<List>) => {
    const transition = replicaReducer(state, action, (key) => view[key], 1);
    state = transition.state;
    for (const write of transition.writes as ReplicaViewWrite<List>[]) {
      if ('type' in write) view = {};
      else if (write.data === undefined) delete view[write.key];
      else view[write.key] = write.data;
    }
    effects.push(...transition.effects);
    return transition;
  };

  return {
    effects,
    run,
    get state() {
      return state;
    },
    get view() {
      return view;
    },
  };
};

const S = 'user-1:personal';
const append = (item: string) => (list: List) => [...list, item];

describe('replicaReducer', () => {
  describe('hydrate vs replace ordering', () => {
    it('hydrates an empty slot without persisting', () => {
      const h = createHarness();
      h.run({ data: ['cached'], key: 'k', scope: S, type: 'hydrate' });

      expect(h.view.k).toEqual(['cached']);
      expect(h.state.entries.k.source).toBe('storage');
      expect(h.effects).toEqual([]);
    });

    it('never lets a late hydrate overwrite a server projection', () => {
      const h = createHarness();
      h.run({ data: () => ['server'], key: 'k', scope: S, type: 'replace' });
      h.run({ data: ['stale-cache'], key: 'k', scope: S, type: 'hydrate' });

      expect(h.view.k).toEqual(['server']);
      expect(h.state.entries.k.source).toBe('server');
    });

    it('does not hydrate over data already in memory (written outside the binding)', () => {
      const h = createHarness({ k: ['memory'] });
      h.run({ data: ['cached'], key: 'k', scope: S, type: 'hydrate' });

      expect(h.view.k).toEqual(['memory']);
    });

    it('repaints a slot answering another query when the caller asks to overwrite', () => {
      const h = createHarness();
      h.run({ data: ['query-1'], key: 'k', params: 1, query: 'q1', scope: S, type: 'hydrate' });

      h.run({
        data: ['query-2'],
        key: 'k',
        overwrite: true,
        params: 2,
        query: 'q2',
        scope: S,
        type: 'hydrate',
      });

      expect(h.view.k).toEqual(['query-2']);
      expect(h.state.entries.k.query).toBe('q2');
      expect(h.state.entries.k.source).toBe('storage');
      expect(h.effects).toEqual([]);
    });

    it('keeps the slot when the overwriting hydrate asks for the query it already answers', () => {
      const h = createHarness();
      h.run({
        data: () => ['server'],
        key: 'k',
        params: 1,
        query: 'q1',
        scope: S,
        type: 'replace',
      });

      const transition = h.run({
        data: ['stale-cache'],
        key: 'k',
        overwrite: true,
        params: 1,
        query: 'q1',
        scope: S,
        type: 'hydrate',
      });

      expect(h.view.k).toEqual(['server']);
      expect(transition.writes).toEqual([]);
    });

    it('never clobbers an in-flight optimistic write, even with overwrite', () => {
      const h = createHarness();
      h.run({ data: ['a'], key: 'k', params: 1, query: 'q1', scope: S, type: 'hydrate' });
      h.run({ apply: append('opt'), id: 1, key: 'k', scope: S, type: 'optimistic' });

      h.run({
        data: ['b'],
        key: 'k',
        overwrite: true,
        params: 2,
        query: 'q2',
        scope: S,
        type: 'hydrate',
      });

      expect(h.view.k).toEqual(['a', 'opt']);
      expect(h.state.entries.k.query).toBe('q1');
    });

    it('replace overwrites hydrated data and persists it', () => {
      const h = createHarness();
      h.run({ data: ['cached'], key: 'k', scope: S, type: 'hydrate' });
      h.run({ data: () => ['server'], key: 'k', scope: S, type: 'replace' });

      expect(h.view.k).toEqual(['server']);
      expect(h.effects).toEqual([{ data: ['server'], key: 'k', scope: S, type: 'persist' }]);
    });

    it('replace merges against the confirmed value and treats undefined as no-op', () => {
      const h = createHarness({ k: ['a'] });
      const before = h.view.k;
      h.run({ data: (confirmed) => confirmed, key: 'k', scope: S, type: 'replace' });
      expect(h.view.k).toBe(before);

      h.run({ data: () => undefined, key: 'k', scope: S, type: 'replace' });
      expect(h.view.k).toBe(before);
      expect(h.state.entries.k.source).toBe('server');
    });
  });

  describe('scope isolation', () => {
    it('ignores actions captured under another scope', () => {
      const h = createHarness();
      h.run({ data: () => ['mine'], key: 'k', scope: S, type: 'replace' });
      h.run({ data: () => ['other-user'], key: 'k', scope: 'user-2:personal', type: 'replace' });
      h.run({ data: ['other'], key: 'j', scope: 'user-2:personal', type: 'hydrate' });

      expect(h.view).toEqual({ k: ['mine'] });
    });

    it('resetScope clears memory of the previous scope', () => {
      const h = createHarness();
      h.run({ data: () => ['mine'], key: 'k', scope: S, type: 'replace' });
      h.run({ scope: 'user-2:personal', type: 'resetScope' });

      expect(h.view).toEqual({});
      expect(h.state).toEqual({ entries: {}, scope: 'user-2:personal' });

      h.run({ data: ['theirs'], key: 'k', scope: 'user-2:personal', type: 'hydrate' });
      expect(h.view.k).toEqual(['theirs']);
    });

    it('adopting the first scope does not clear data already in memory', () => {
      const h = createHarness({ k: ['memory'] });
      h.run({ scope: S, type: 'resetScope' });
      expect(h.view.k).toEqual(['memory']);
    });
  });

  describe('optimistic overlay', () => {
    it('commit keeps the view and persists the confirmed value', () => {
      const h = createHarness({ k: ['a'] });
      h.run({ apply: append('b'), id: 1, key: 'k', scope: S, type: 'optimistic' });
      expect(h.view.k).toEqual(['a', 'b']);
      expect(h.effects).toEqual([]);

      h.run({ id: 1, key: 'k', scope: S, type: 'commit' });
      expect(h.view.k).toEqual(['a', 'b']);
      expect(h.state.entries.k.pending).toEqual([]);
      expect(h.state.entries.k.base).toBeUndefined();
      expect(h.effects).toEqual([{ data: ['a', 'b'], key: 'k', scope: S, type: 'persist' }]);
    });

    it('rollback restores the confirmed value without persisting', () => {
      const h = createHarness({ k: ['a'] });
      h.run({ apply: append('b'), id: 1, key: 'k', scope: S, type: 'optimistic' });
      h.run({ id: 1, key: 'k', scope: S, type: 'rollback' });

      expect(h.view.k).toEqual(['a']);
      expect(h.effects).toEqual([]);
    });

    it('rolling back one mutation keeps the other in-flight overlays', () => {
      const h = createHarness({ k: ['a'] });
      h.run({ apply: append('b'), id: 1, key: 'k', scope: S, type: 'optimistic' });
      h.run({ apply: append('c'), id: 2, key: 'k', scope: S, type: 'optimistic' });
      h.run({ id: 1, key: 'k', scope: S, type: 'rollback' });

      expect(h.view.k).toEqual(['a', 'c']);
      h.run({ id: 2, key: 'k', scope: S, type: 'commit' });
      expect(h.view.k).toEqual(['a', 'c']);
      expect(h.effects.at(-1)).toEqual({ data: ['a', 'c'], key: 'k', scope: S, type: 'persist' });
    });

    it('a background replace rebases pending overlays instead of hiding them', () => {
      const h = createHarness({ k: ['a'] });
      h.run({ apply: append('b'), id: 1, key: 'k', scope: S, type: 'optimistic' });
      h.run({ data: () => ['a', 'z'], key: 'k', scope: S, type: 'replace' });

      expect(h.view.k).toEqual(['a', 'z', 'b']);
      // Only the server value is persisted, never the optimistic overlay.
      expect(h.effects.at(-1)).toEqual({ data: ['a', 'z'], key: 'k', scope: S, type: 'persist' });

      h.run({ id: 1, key: 'k', scope: S, type: 'rollback' });
      expect(h.view.k).toEqual(['a', 'z']);
    });

    it('commit can confirm with the server result', () => {
      const h = createHarness({ k: ['a'] });
      h.run({ apply: append('tmp'), id: 1, key: 'k', scope: S, type: 'optimistic' });
      h.run({ confirm: append('real'), id: 1, key: 'k', scope: S, type: 'commit' });

      expect(h.view.k).toEqual(['a', 'real']);
    });

    it('an optimistic write on an unloaded key is a no-op', () => {
      const h = createHarness();
      h.run({ apply: append('b'), id: 1, key: 'k', scope: S, type: 'optimistic' });
      h.run({ id: 1, key: 'k', scope: S, type: 'commit' });

      expect(h.view).toEqual({});
      expect(h.effects).toEqual([]);
    });

    it('drops a commit that lands after a scope switch', () => {
      const h = createHarness({ k: ['a'] });
      h.run({ apply: append('b'), id: 1, key: 'k', scope: S, type: 'optimistic' });
      h.run({ scope: 'user-2:personal', type: 'resetScope' });
      h.run({ id: 1, key: 'k', scope: S, type: 'commit' });

      expect(h.view).toEqual({});
      expect(h.effects).toEqual([]);
    });
  });

  describe('confirmed local updates', () => {
    it('patches view and base under an overlay, persisting the confirmed value', () => {
      const h = createHarness({ k: ['a'] });
      h.run({ apply: append('opt'), id: 1, key: 'k', scope: S, type: 'optimistic' });
      h.run({
        apply: (list) => list && [...list, 'confirmed'],
        key: 'k',
        persist: true,
        scope: S,
        type: 'update',
      });

      expect(h.view.k).toEqual(['a', 'opt', 'confirmed']);
      expect(h.effects).toEqual([
        { data: ['a', 'confirmed'], key: 'k', scope: S, type: 'persist' },
      ]);

      h.run({ id: 1, key: 'k', scope: S, type: 'rollback' });
      expect(h.view.k).toEqual(['a', 'confirmed']);
    });

    it('persist: false only touches memory', () => {
      const h = createHarness({ k: ['a'] });
      h.run({ apply: () => ['b'], key: 'k', persist: false, scope: S, type: 'update' });

      expect(h.view.k).toEqual(['b']);
      expect(h.effects).toEqual([]);
    });

    it('remove drops the entry and its persisted row', () => {
      const h = createHarness({ k: ['a'] });
      h.run({ key: 'k', scope: S, type: 'remove' });

      expect(h.view).toEqual({});
      expect(h.effects).toEqual([{ key: 'k', scope: S, type: 'remove' }]);
    });
  });
});
