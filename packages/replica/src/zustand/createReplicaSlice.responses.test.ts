/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';

import { testDriver as driver } from '../../tests/testDriver';
import { defineReplica } from '../core/defineReplica';
import { singleEntity } from '../core/entityAdapters';
import { createReplicaState } from '../core/reducer';
import type { ReplicaState } from '../core/types';
import { createReplicaSlice, recordLens } from './createReplicaSlice';
import type { TestState } from './testUtils';
import { resetScopeState, scope, scopeState } from './testUtils';

beforeEach(resetScopeState);

describe('createReplicaSlice', () => {
  describe('missing responses', () => {
    it('applies a response the resource marks as missing as an explicit removal', () => {
      // A nullable detail (e.g. the acceptance attached to a subject): the
      // server answering "none" must clear a previously cached value, not let
      // the merge fall back to it.
      type NullableState = {
        notes: Record<string, string[] | null>;
        notesReplica: ReplicaState<string[] | null>;
      };
      const resource = defineReplica<{ id: string }, string[] | null>({
        key: ({ id }) => id,
        name: 'nullableNote',
        scope,
        version: 1,
      });
      const store = createStore<NullableState>()(() => ({
        notes: {},
        notesReplica: createReplicaState(),
      }));
      const slice = createReplicaSlice<NullableState, { id: string }, string[] | null>(resource, {
        driver,
        get: store.getState,
        isMissing: (note) => note === null,
        set: (partial) => store.setState(partial),
        stateKey: 'notesReplica',
        view: recordLens('notes'),
      });

      act(() => slice.replace({ id: 'a' }, ['kept']));
      expect(store.getState().notes.a).toEqual(['kept']);

      act(() => slice.replace({ id: 'a' }, null));
      expect(store.getState().notes.a).toBeUndefined();
      expect(store.getState().notesReplica.entries.a).toBeUndefined();
    });

    it('treats a repeated missing response as a no-op', () => {
      type NullableState = {
        notes: Record<string, string[] | null>;
        notesReplica: ReplicaState<string[] | null>;
      };
      const resource = defineReplica<{ id: string }, string[] | null>({
        key: ({ id }) => id,
        name: 'nullableNoteRepeat',
        scope,
        version: 1,
      });
      const store = createStore<NullableState>()(() => ({
        notes: {},
        notesReplica: createReplicaState(),
      }));
      const slice = createReplicaSlice<NullableState, { id: string }, string[] | null>(resource, {
        driver,
        get: store.getState,
        isMissing: (note) => note === null,
        set: (partial) => store.setState(partial),
        stateKey: 'notesReplica',
        view: recordLens('notes'),
      });

      act(() => slice.replace({ id: 'a' }, ['kept']));
      // The first "missing" drops the entry and clears stale storage…
      expect(slice.replace({ id: 'a' }, null)).toBe(true);
      // …a poll that still answers "missing" must not re-emit the removal.
      expect(slice.replace({ id: 'a' }, null)).toBe(false);
      expect(store.getState().notes.a).toBeUndefined();
    });
  });

  describe('late scoped responses', () => {
    it('does not replay a response that lands after a scope switch', () => {
      // A driver that settles each request through its own callback, so the
      // test chooses the moment the response arrives.
      let settle!: (data: string[]) => void;
      const useQuery = vi.fn((key: any, _fetcher: unknown, options: any) => {
        if (key !== null) settle = options.onSuccess;
        return { isValidating: false, mutate: vi.fn() };
      });
      const resource = defineReplica<{ id: string }, string[]>({
        fetcher: async () => ['server'],
        key: ({ id }) => id,
        name: 'lateScopeResponse',
        scope,
        version: 1,
      });
      const store = createStore<TestState>()(() => ({
        lists: {},
        listsReplica: createReplicaState(),
      }));
      const slice = createReplicaSlice<TestState, { id: string }, string[]>(resource, {
        driver: { revalidate: vi.fn(), useQuery },
        get: store.getState,
        set: (partial) => store.setState(partial),
        stateKey: 'listsReplica',
        view: recordLens('lists'),
      });

      const onSuccess = vi.fn();
      renderHook(() => slice.useSync({ id: 'a' }, { onSuccess }));

      // The identity switches while the request is in flight; the response
      // belongs to the previous scope and `replace` rejects it.
      scopeState.current = 'user-2:personal';
      act(() => settle(['late-user-1']));

      expect(store.getState().lists.a).toBeUndefined();
      expect(onSuccess).not.toHaveBeenCalled();
    });

    // An entity removed while its entry's request is in flight (deleted, pruned
    // by an authoritative parent list) must not be recreated by that response.
    // `slice.remove` drops the head-query marker, but an entity removal goes
    // straight through the engine, so the request generation must catch it.
    it('drops a response whose request started before the entity was removed', () => {
      interface Item {
        id: string;
        title: string;
      }
      interface ItemState {
        items: Record<string, Item>;
        itemsReplica: ReplicaState<Item>;
      }
      let settle!: (data: Item) => void;
      const useQuery = vi.fn((key: any, fetcher: () => unknown, options: any) => {
        if (key !== null) {
          settle = options.onSuccess;
          void fetcher();
        }
        return { isValidating: false, mutate: vi.fn() };
      });
      const resource = defineReplica<{ id: string }, Item>({
        fetcher: () => new Promise<Item>(() => {}),
        key: ({ id }) => id,
        name: 'removedEntityInFlight',
        scope,
        version: 1,
      });
      const store = createStore<ItemState>()(() => ({
        items: {},
        itemsReplica: createReplicaState(),
      }));
      const slice = createReplicaSlice<ItemState, { id: string }, Item>(resource, {
        driver: { revalidate: vi.fn(), useQuery },
        entity: singleEntity<Item>((item) => item.id),
        get: store.getState,
        set: (partial) => store.setState(partial),
        stateKey: 'itemsReplica',
        view: recordLens('items'),
      });
      act(() => slice.replace({ id: 'a' }, { id: 'a', title: 'first' }));

      const onSuccess = vi.fn();
      renderHook(() => slice.useSync({ id: 'a' }, { onSuccess }));
      act(() => slice.removeEntity('a'));
      expect(store.getState().items.a).toBeUndefined();

      act(() => settle({ id: 'a', title: 'stale' }));
      expect(store.getState().items.a).toBeUndefined();
      expect(onSuccess).not.toHaveBeenCalled();
    });

    // a → b while a's request is in flight: a's late response still fills its
    // own cache entry, but its success side effects act on the CURRENT view, so
    // they must not re-adopt `a` while the hook shows `b`.
    it('does not replay a response for a key the hook has moved past', () => {
      let settle!: (data: string[]) => void;
      const useQuery = vi.fn((key: any, _fetcher: unknown, options: any) => {
        if (key !== null) settle = options.onSuccess;
        return { isValidating: false, mutate: vi.fn() };
      });
      const resource = defineReplica<{ id: string }, string[]>({
        fetcher: async ({ id }) => [id],
        key: ({ id }) => id,
        name: 'lateKeyResponse',
        scope,
        version: 1,
      });
      const store = createStore<TestState>()(() => ({
        lists: {},
        listsReplica: createReplicaState(),
      }));
      const slice = createReplicaSlice<TestState, { id: string }, string[]>(resource, {
        driver: { revalidate: vi.fn(), useQuery },
        get: store.getState,
        set: (partial) => store.setState(partial),
        stateKey: 'listsReplica',
        view: recordLens('lists'),
      });

      const onSuccess = vi.fn();
      const { rerender } = renderHook(({ id }) => slice.useSync({ id }, { onSuccess }), {
        initialProps: { id: 'a' },
      });
      const settleA = settle;

      rerender({ id: 'b' });
      const settleB = settle;
      act(() => settleA(['late-a']));

      expect(store.getState().lists.a).toEqual(['late-a']);
      expect(onSuccess).not.toHaveBeenCalled();

      act(() => settleB(['b']));
      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledWith(['b']);
    });
  });
});
