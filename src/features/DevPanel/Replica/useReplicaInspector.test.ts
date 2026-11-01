import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';

import {
  createReplicaSlice,
  createReplicaState,
  defineReplica,
  recordLens,
  type ReplicaState,
} from '@/libs/replica';

import { useEntryEditor } from './useEntryEditor';
import { useReplicaInspector } from './useReplicaInspector';

vi.mock('@/libs/swr', () => ({ mutate: vi.fn(), useClientDataSWR: vi.fn() }));

interface Topic {
  createdAt: Date;
  title: string;
}

interface TestState {
  topics: Record<string, Topic>;
  topicsReplica: ReplicaState<Topic>;
}

const resource = defineReplica<{ id: string }, Topic>({
  key: ({ id }) => id,
  name: 'inspectorTopic',
  scope: { canPersist: () => false, get: () => 'user-1:personal', use: () => 'user-1:personal' },
  storage: 'memory',
  version: 1,
});
const store = createStore<TestState>()(() => ({
  topics: {},
  topicsReplica: createReplicaState(),
}));
const slice = createReplicaSlice<TestState, { id: string }, Topic>(resource, {
  get: store.getState,
  set: (partial) => store.setState(partial),
  stateKey: 'topicsReplica',
  view: recordLens('topics'),
});

const createdAt = new Date('2026-10-16T00:00:00.000Z');

describe('useReplicaInspector', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('follows replica commits live and writes edits back through the slice', () => {
    slice.update('t1', () => ({ createdAt, title: 'Draft' }));

    const { result } = renderHook(() => useReplicaInspector());
    act(() => result.current.selectResource(resource.namespace));

    expect(result.current.selected?.resource).toBe(resource);
    expect(result.current.selectedRow).toMatchObject({ key: 't1', source: 'local' });

    act(() => {
      slice.update('t2', () => ({ createdAt, title: 'Second' }));
      vi.advanceTimersByTime(200);
    });
    expect(result.current.totalCount).toBe(2);

    const editor = renderHook(() => useEntryEditor(result.current.selected, 't1'));
    act(() => editor.result.current.start());
    act(() =>
      editor.result.current.setDraft(editor.result.current.draft!.replace('"Draft"', '"Renamed"')),
    );
    act(() => editor.result.current.apply());

    expect(editor.result.current.isEditing).toBe(false);
    expect(store.getState().topics.t1).toEqual({ createdAt, title: 'Renamed' });
  });

  it('keeps the draft open and reports invalid JSON', () => {
    slice.update('t3', () => ({ createdAt, title: 'Keep' }));
    const { result } = renderHook(() => useReplicaInspector());
    act(() => result.current.selectResource(resource.namespace));

    const editor = renderHook(() => useEntryEditor(result.current.selected, 't3'));
    act(() => editor.result.current.start());
    act(() => editor.result.current.setDraft('{ not json'));
    act(() => editor.result.current.apply());

    expect(editor.result.current.isEditing).toBe(true);
    expect(editor.result.current.error).toBeTruthy();
    expect(store.getState().topics.t3.title).toBe('Keep');
  });
});
