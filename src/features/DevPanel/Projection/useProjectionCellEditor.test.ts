import { act, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyProjectionScope } from '@/projection/core/initialState';
import { getProjectionStoreState, useProjectionStore } from '@/projection/store';

import type { ProjectionTableCell } from './model';
import { createProjectionPropertyCell } from './propertyTree';
import { useProjectionCellEditor } from './useProjectionCellEditor';

const scopeId = 'cell-editor:personal';
const record = {
  fragments: {
    display: { data: { title: 'Initial' }, observedAt: 10, source: 'network' as const },
  },
  id: 'topic-1',
  kind: 'topic' as const,
};

const cell: ProjectionTableCell = {
  column: {
    fieldName: 'display',
    id: 'field:display',
    kind: 'field',
    label: 'display',
    width: 260,
  },
  displayValue: '{"title":"Initial"}',
  editTarget: {
    fragmentName: 'display',
    projection: { entryKey: 'cell-editor::topic::topic-1', record, scope: scopeId },
    type: 'fragment',
  },
  key: 'cell-editor::topic::topic-1:field:display',
  title: '{\n  "title": "Initial"\n}',
  value: { title: 'Initial' },
};

const StrictModeWrapper = ({ children }: PropsWithChildren) =>
  createElement(StrictMode, null, children);

describe('useProjectionCellEditor', () => {
  beforeEach(() => {
    const scope = createEmptyProjectionScope('ready');
    scope.records.topic[record.id] = record;
    useProjectionStore.setState({ scopes: { [scopeId]: scope } });
  });

  afterEach(() => {
    useProjectionStore.setState({ scopes: {} });
    vi.restoreAllMocks();
  });

  it('applies a valid cell draft to the live Projection Store', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100);
    const onFeedback = vi.fn();
    const { result } = renderHook(() => useProjectionCellEditor({ onFeedback }));

    await act(() => result.current.begin(cell));
    act(() => result.current.setDraft('{"title":"Edited"}'));
    await act(async () => expect(await result.current.commit()).toBe(true));

    expect(
      getProjectionStoreState().scopes[scopeId].records.topic[record.id].fragments.display,
    ).toEqual({ data: { title: 'Edited' }, observedAt: 100, source: 'mutation' });
    expect(result.current.activeCell).toBeNull();
    expect(onFeedback).toHaveBeenCalledWith({ message: 'Saved display.', status: 'saved' });
  });

  it('applies a leaf draft through its fragment property path', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100);
    const titleCell = createProjectionPropertyCell(cell, {
      label: 'title',
      segment: 'title',
      value: 'Initial',
    });
    const { result } = renderHook(() => useProjectionCellEditor());

    await act(() => result.current.begin(titleCell));
    act(() => result.current.setDraft('Edited'));
    await act(async () => expect(await result.current.commit()).toBe(true));

    expect(
      getProjectionStoreState().scopes[scopeId].records.topic[record.id].fragments.display,
    ).toEqual({ data: { title: 'Edited' }, observedAt: 100, source: 'mutation' });
  });

  it('leaves the applying phase after a Strict Mode commit and permits the next edit', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100);
    const titleCell = createProjectionPropertyCell(cell, {
      label: 'title',
      segment: 'title',
      value: 'Initial',
    });
    const { result } = renderHook(() => useProjectionCellEditor(), {
      wrapper: StrictModeWrapper,
    });

    await act(() => result.current.begin(titleCell));
    act(() => result.current.setDraft('Edited'));
    await act(async () => expect(await result.current.commit()).toBe(true));

    expect(result.current.activeCell).toBeNull();
    expect(result.current.isApplying).toBe(false);

    await act(() => result.current.begin(titleCell));
    expect(result.current.activeCell?.key).toBe(titleCell.key);
  });

  it('treats an untouched pretty JSON draft as unchanged', async () => {
    const onFeedback = vi.fn();
    const { result } = renderHook(() => useProjectionCellEditor({ onFeedback }));

    await act(() => result.current.begin(cell, { pretty: true }));
    expect(result.current.draft).toBe('{\n  "title": "Initial"\n}');
    await act(async () => expect(await result.current.commit()).toBe(true));

    expect(
      getProjectionStoreState().scopes[scopeId].records.topic[record.id].fragments.display,
    ).toEqual(record.fragments.display);
    expect(onFeedback).toHaveBeenLastCalledWith({ message: 'No changes.', status: 'idle' });
  });

  it('keeps an invalid draft active so it can be corrected', async () => {
    const onFeedback = vi.fn();
    const { result } = renderHook(() => useProjectionCellEditor({ onFeedback }));

    await act(() => result.current.begin(cell));
    act(() => result.current.setDraft('[]'));
    await act(async () => expect(await result.current.commit()).toBe(false));

    expect(result.current.activeCell?.key).toBe(cell.key);
    expect(result.current.draft).toBe('[]');
    expect(result.current.error).toBe('Fragment data must be a JSON object.');
    expect(
      getProjectionStoreState().scopes[scopeId].records.topic[record.id].fragments.display?.data,
    ).toEqual({ title: 'Initial' });
  });

  it('clears stale editing feedback when an unchanged draft closes or is cancelled', async () => {
    const onFeedback = vi.fn();
    const { result } = renderHook(() => useProjectionCellEditor({ onFeedback }));

    await act(() => result.current.begin(cell));
    await act(async () => expect(await result.current.commit()).toBe(true));
    expect(onFeedback).toHaveBeenLastCalledWith({ message: 'No changes.', status: 'idle' });

    await act(() => result.current.begin(cell));
    act(() => result.current.cancel());
    expect(onFeedback).toHaveBeenLastCalledWith({ message: 'Edit cancelled.', status: 'idle' });
    expect(result.current.activeCell).toBeNull();
  });
});
