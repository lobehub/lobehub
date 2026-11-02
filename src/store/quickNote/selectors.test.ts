import isEqual from 'fast-deep-equal';
import { describe, expect, it } from 'vitest';

import type { QuickNoteItem } from '@/services/quickNote';

import { initialState, type QuickNoteState } from './initialState';
import { quickNoteSelectors } from './selectors';

const note: QuickNoteItem = {
  collection: 'Research',
  content: 'Original note',
  createdAt: 1000,
  id: 'note-1',
  run: { kind: 'analyze', status: 'completed' },
  summary: { completedAt: 1000, content: 'Existing analysis' },
  tags: ['Voice'],
  updatedAt: 1000,
};

const stateWith = (notes: QuickNoteItem[]): QuickNoteState => ({ ...initialState, notes });

const base = stateWith([note]);
const contentEdited = stateWith([{ ...note, content: 'Edited note' }]);
const polledClone = stateWith(structuredClone([note]));
const resummarized = stateWith([
  { ...note, summary: { completedAt: 2000, content: 'New analysis' }, tags: ['Audio'] },
]);

// ROOT CAUSE:
// The AI panel selected the entire note; bucket selectors returned new objects.
// Updating content or cloning a polling response therefore committed both regions.
// Select only displayed fields and compare them with `fast-deep-equal` (as the components do).
/** @example Editing text or polling identical data leaves the AI panel and filter views equal. */
describe('quickNoteSelectors render isolation', () => {
  const regions = {
    aiPanelViewById: quickNoteSelectors.aiPanelViewById(note.id),
    collections: quickNoteSelectors.collections,
    runById: quickNoteSelectors.runById(note.id),
    tags: quickNoteSelectors.tags,
  };

  it.each(Object.entries(regions))('%s ignores content edits and cloned polls', (_, select) => {
    /** @example Content edits do not change the selected view. */
    expect(isEqual(select(base), select(contentEdited))).toBe(true);
    /** @example A new response identity alone does not change the selected view. */
    expect(isEqual(select(base), select(polledClone))).toBe(true);
  });

  it('propagates real summary and tag changes', () => {
    const view = quickNoteSelectors.aiPanelViewById(note.id)(resummarized);

    /** @example Real summary changes still reach the AI panel. */
    expect(view).toMatchObject({ summaryContent: 'New analysis', tags: ['Audio'] });
    expect(isEqual(quickNoteSelectors.aiPanelViewById(note.id)(base), view)).toBe(false);
    /** @example Real tag changes still update the filter. */
    expect(quickNoteSelectors.tags(resummarized)).toEqual([{ count: 1, name: 'Audio' }]);
    expect(isEqual(quickNoteSelectors.tags(base), quickNoteSelectors.tags(resummarized))).toBe(
      false,
    );
  });

  it('reports an empty view for a missing note', () => {
    /** @example A missing note renders nothing in the AI panel. */
    expect(quickNoteSelectors.aiPanelViewById('missing')(base)).toEqual({
      exists: false,
      hasContent: false,
      summaryContent: undefined,
      summaryState: 'emptyNote',
      tags: [],
    });
  });
});

// ROOT CAUSE:
// The panel only knew "summary or not", so a note whose analysis finished without a summary
// (keep-only, or a page write) kept saying the summary would appear after analysis.
/** @example Waiting and finished-without-summary read differently. */
describe('quickNoteSelectors summary state', () => {
  const unsummarized = { ...note, summary: undefined };
  const stateOf = (patch: Partial<QuickNoteItem>) =>
    quickNoteSelectors.aiPanelViewById(note.id)(stateWith([{ ...unsummarized, ...patch }]))
      .summaryState;

  it('is ready when a summary exists', () => {
    expect(quickNoteSelectors.aiPanelViewById(note.id)(base).summaryState).toBe('ready');
  });

  it('is none when the latest analysis completed without a summary', () => {
    expect(stateOf({ run: { kind: 'analyze', status: 'completed' } })).toBe('none');
  });

  it.each([
    ['never analyzed', { run: undefined }],
    ['running', { run: { kind: 'analyze', status: 'running' } }],
    ['pending', { run: { kind: 'analyze', status: 'pending' } }],
    ['failed', { run: { kind: 'analyze', status: 'failed' } }],
    [
      're-scheduled after an edit',
      { analyzeDueAt: 5000, run: { kind: 'analyze', status: 'completed' } },
    ],
  ] as const)('is waiting when %s', (_, patch) => {
    expect(stateOf(patch as Partial<QuickNoteItem>)).toBe('waiting');
  });

  it('is emptyNote for a blank note', () => {
    expect(stateOf({ content: '  ', run: { kind: 'analyze', status: 'completed' } })).toBe(
      'emptyNote',
    );
  });
});
