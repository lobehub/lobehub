import { cleanup, render, screen } from '@testing-library/react';
import { act, Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { QuickNoteItem } from '@/services/quickNote';
import { useQuickNoteStore } from '@/store/quickNote';
import { initialState } from '@/store/quickNote/initialState';

import AiPanel from './NoteDetail/AiPanel';
import AnalyzeAction from './NoteDetail/AnalyzeAction';
import FilterChips from './NoteLayout/FilterChips';

// NOTICE:
// Keep network-backed children out of this subscription regression test.
// Their independent fetches would add unrelated commits to the Profiler measurement.
// Source: NoteDetail/AgenticSections.tsx and AnalyzeSettings.tsx.
// Remove these mocks if those children gain a shared test transport fixture.
vi.mock('./NoteDetail/AgenticSections', () => ({ default: () => null }));
vi.mock('./NoteDetail/AnalyzeSettings', () => ({ default: () => null }));
vi.mock('./NoteDetail/CommentComposer', () => ({ default: () => null }));
vi.mock('@/services/quickNote', () => ({ quickNoteService: {} }));
vi.mock('@/store/user', () => ({ useUserStore: () => undefined }));

// NOTICE:
// This test needs the production equality behavior, not the automatic store-reset mock.
// The global mock replaces the configured shallow comparator with Object.is.
// Source: __mocks__/zustand/traditional.ts createImpl.
// Remove this override once that mock preserves the caller's equality function.
vi.unmock('zustand/traditional');

const note: QuickNoteItem = {
  annotation: { content: 'Existing analysis', divedAt: 1000 },
  collection: 'Research',
  content: 'Original note',
  createdAt: 1000,
  id: 'note-1',
  run: { kind: 'analyze', status: 'completed' },
  tags: ['Voice'],
  updatedAt: 1000,
};

beforeEach(() => useQuickNoteStore.setState({ ...initialState, notes: [note] }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** @example Editing text updates its consumer without committing the AI or filter regions. */
describe('Quick Note render isolation', () => {
  /** @example A content update and an identical polling response leave unrelated regions untouched. */
  it('keeps analysis and filters stable while note text changes', () => {
    // ROOT CAUSE:
    // The AI panel selected the entire note; bucket selectors returned new objects.
    // Updating content or cloning a polling response therefore committed both regions.
    // Select only displayed fields and compare bucket values to isolate these updates.
    const aiCommit = vi.fn();
    const filterCommit = vi.fn();
    const Content = () => <span>{useQuickNoteStore((s) => s.notes[0]?.content)}</span>;
    render(
      <>
        <Content />
        <Profiler id="ai" onRender={aiCommit}>
          <AiPanel noteId={note.id} />
        </Profiler>
        <Profiler id="filters" onRender={filterCommit}>
          <FilterChips />
        </Profiler>
      </>,
    );
    aiCommit.mockClear();
    filterCommit.mockClear();
    act(() => useQuickNoteStore.setState({ notes: [{ ...note, content: 'Edited note' }] }));
    /** @example The changed value actually reaches the UI. */
    expect(screen.getByText('Edited note')).toBeTruthy();
    /** @example Content edits do not commit unrelated analysis. */
    expect(aiCommit).not.toHaveBeenCalled();
    /** @example Content edits do not rebuild category/tag filters. */
    expect(filterCommit).not.toHaveBeenCalled();

    act(() =>
      useQuickNoteStore.setState({ notes: structuredClone(useQuickNoteStore.getState().notes) }),
    );
    /** @example Polling identical values preserves the same render boundaries. */
    expect(aiCommit).not.toHaveBeenCalled();
    /** @example A new response identity alone does not redraw filters. */
    expect(filterCommit).not.toHaveBeenCalled();

    act(() =>
      useQuickNoteStore.setState({
        notes: [
          { ...note, annotation: { content: 'New analysis', divedAt: 2000 }, tags: ['Audio'] },
        ],
      }),
    );
    /** @example Real annotation changes are still displayed. */
    expect(screen.getByText('New analysis')).toBeTruthy();
    /** @example Real tag changes still update the filter. */
    expect(screen.getAllByText('Audio').length).toBeGreaterThan(0);
  });
  /** @example An expired countdown stops committing while the backend is still delayed. */
  it('stops the countdown clock at the deadline', () => {
    // ROOT CAUSE:
    // AnalyzeAction cleared its interval only when dueAt changed or it unmounted.
    // An unchanged expired deadline kept scheduling renders ten times per second.
    // Stop the interval on the tick that reaches the deadline.
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    useQuickNoteStore.setState({ notes: [{ ...note, analyzeDueAt: 11_000 }] });
    const commits = vi.fn();
    render(
      <Profiler id="countdown" onRender={commits}>
        <AnalyzeAction noteId={note.id} />
      </Profiler>,
    );
    /** @example The countdown is initially visible. */
    expect(screen.getByRole('button', { name: 'editor.analyzeScheduled' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(1000));
    /** @example The action returns to its normal label at expiry. */
    expect(screen.getByRole('button', { name: 'editor.analyze' })).toBeTruthy();
    commits.mockClear();
    act(() => vi.advanceTimersByTime(5000));
    /** @example A delayed server response does not keep the expired clock rendering. */
    expect(commits).not.toHaveBeenCalled();
  });
});
