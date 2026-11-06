import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ExperimentDraft,
  experimentDraftKey,
  getInvalidDraftSelections,
  parseExperimentDraft,
} from './experimentDraft';
import { useExperimentDraft } from './useExperimentDraft';

const initial = (benchmarkId: string): ExperimentDraft => ({
  contenders: [],
  datasetId: `dataset-${benchmarkId}`,
  k: 1,
  maxSteps: 30,
  name: '',
  pickCases: false,
  pickedCaseIds: [],
  question: '',
  timeoutMinutes: 20,
});
const contender = {
  id: 'contender-1',
  model: 'model-1',
  name: 'Model one',
  provider: 'provider-1',
};
const options = {
  benchmarkIds: ['bench-1', 'bench-2'],
  getInitialDraft: initial,
  initialBenchmarkId: 'bench-1',
  ready: true,
  userId: 'user-1',
  workspaceId: null as string | null,
};
const key = experimentDraftKey({ benchmarkId: 'bench-1', userId: 'user-1', workspaceId: null });

describe('useExperimentDraft', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('restores the whole form after leaving the route or reloading', () => {
    const first = renderHook(() => useExperimentDraft(options));
    act(() =>
      first.result.current.updateDraft({
        contenders: [
          { ...contender, params: { temperature: 0.7 }, chatConfig: { reasoningEffort: 'high' } },
        ],
        judge: { model: 'judge-1', provider: 'provider-1' },
        k: 3,
        maxSteps: 50,
        name: 'My experiment',
        pickCases: true,
        pickedCaseIds: ['4'],
        question: 'Can this model do the task?',
        timeoutMinutes: 40,
      }),
    );
    const before = first.result.current.draft;
    // The write is already durable before unmount; no cleanup or debounce is needed.
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(before);
    first.unmount();
    const second = renderHook(() => useExperimentDraft(options));
    expect(second.result.current.draft).toEqual(before);
    expect(second.result.current.restored).toBe(true);
  });

  it('waits for account and datasets before restoring, without overwriting the saved form', () => {
    localStorage.setItem(key, JSON.stringify({ ...initial('bench-1'), name: 'Saved' }));
    const { result, rerender } = renderHook((props) => useExperimentDraft(props), {
      initialProps: { ...options, ready: false, userId: undefined as string | undefined },
    });
    expect(result.current.ready).toBe(false);
    act(() => result.current.updateDraft({ name: 'Too early' }));
    expect(JSON.parse(localStorage.getItem(key)!).name).toBe('Saved');
    rerender({ ...options, ready: true });
    expect(result.current.draft?.name).toBe('Saved');
  });

  it('isolates drafts when the active account or workspace changes', () => {
    const { result, rerender } = renderHook((props) => useExperimentDraft(props), {
      initialProps: options,
    });
    act(() => result.current.updateDraft({ name: 'Private draft' }));
    rerender({ ...options, userId: 'user-2' });
    expect(result.current.draft?.name).toBe('');
    act(() => result.current.updateDraft({ name: 'Other user' }));
    rerender({ ...options, workspaceId: 'workspace-2' });
    expect(result.current.draft?.name).toBe('');
    act(() => result.current.updateDraft({ name: 'Team draft' }));
    rerender(options);
    expect(result.current.draft?.name).toBe('Private draft');
  });

  it('keeps separate benchmark drafts and restores the last selected benchmark on return', () => {
    const first = renderHook(() => useExperimentDraft(options));
    act(() => first.result.current.updateDraft({ name: 'First benchmark' }));
    act(() => first.result.current.selectDataset('bench-2', 'dataset-bench-2'));
    expect(first.result.current.draft?.name).toBe('');
    act(() => first.result.current.updateDraft({ name: 'Second benchmark' }));
    first.unmount();
    const second = renderHook(() => useExperimentDraft(options));
    expect(second.result.current.draft?.name).toBe('Second benchmark');
    act(() => second.result.current.selectDataset('bench-1', 'dataset-bench-1'));
    expect(second.result.current.draft?.name).toBe('First benchmark');
  });

  it('honors an explicit dataset URL while never applying another dataset’s picked IDs', () => {
    localStorage.setItem(
      key,
      JSON.stringify({
        ...initial('bench-1'),
        name: 'Saved',
        pickCases: true,
        pickedCaseIds: ['old-case'],
      }),
    );
    const { result } = renderHook(() =>
      useExperimentDraft({ ...options, presetDatasetId: 'dataset-new' }),
    );
    expect(result.current.draft).toMatchObject({
      datasetId: 'dataset-new',
      name: 'Saved',
      pickCases: true,
      pickedCaseIds: [],
    });
    // Reading a different entry point does not destroy the existing draft.
    expect(JSON.parse(localStorage.getItem(key)!).pickedCaseIds).toEqual(['old-case']);
  });

  it('keeps failed or unfinished starts and clears only on explicit success or discard', () => {
    const { result, unmount } = renderHook(() => useExperimentDraft(options));
    act(() => result.current.updateDraft({ name: 'Retry this experiment' }));
    // An unsuccessful API request never calls clearDraft, so its inputs survive.
    expect(JSON.parse(localStorage.getItem(key)!).name).toBe('Retry this experiment');
    act(() => result.current.clearDraft());
    expect(localStorage.getItem(key)).toBeNull();
    unmount();
    const next = renderHook(() => useExperimentDraft(options));
    expect(next.result.current.draft?.name).toBe('');
    act(() => next.result.current.updateDraft({ name: 'Discard this' }));
    act(() => next.result.current.clearDraft(true));
    expect(next.result.current.draft).toEqual(initial('bench-1'));
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('does not reapply another benchmark’s URL preset after discarding a switched draft', () => {
    const { result } = renderHook(() =>
      useExperimentDraft({ ...options, presetDatasetId: 'preset-bench-1' }),
    );
    act(() => result.current.selectDataset('bench-2', 'dataset-bench-2'));
    act(() => result.current.updateDraft({ name: 'Discard second benchmark' }));
    act(() => result.current.clearDraft(true));
    expect(result.current.draft).toEqual(initial('bench-2'));
  });

  it('retains in-memory input and exposes a storage failure instead of throwing', () => {
    const { result } = renderHook(() => useExperimentDraft(options));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });
    act(() => result.current.updateDraft({ name: 'Do not lose this' }));
    expect(result.current.draft?.name).toBe('Do not lose this');
    expect(result.current.storageError).toBe(true);
  });
});

describe('experiment draft validation', () => {
  it('ignores corrupt or incompatible storage and strips unrelated execution fields', () => {
    expect(parseExperimentDraft('{')).toBeUndefined();
    expect(parseExperimentDraft(JSON.stringify({ name: 1 }))).toBeUndefined();
    expect(
      parseExperimentDraft(
        JSON.stringify({
          ...initial('bench-1'),
          contenders: [{ ...contender, runId: 'run-1' }],
          secret: 'not-a-form-field',
        }),
      ),
    ).toEqual({ ...initial('bench-1'), contenders: [contender] });
  });

  it('identifies missing cases and unavailable model capabilities without changing the draft', () => {
    const draft: ExperimentDraft = {
      ...initial('bench-1'),
      contenders: [contender],
      judge: { model: 'judge-1', provider: 'provider-1' },
      pickCases: true,
      pickedCaseIds: ['valid', 'removed'],
    };
    const unavailable = getInvalidDraftSelections(
      draft,
      ['valid'],
      [{ model: 'model-1', provider: 'provider-1', supportsTools: false }],
    );
    expect(unavailable).toEqual({ caseIds: ['removed'], contenders: [contender], judge: true });
    expect(draft.pickedCaseIds).toEqual(['valid', 'removed']);
    expect(draft.pickCases).toBe(true);
    expect(
      getInvalidDraftSelections(
        draft,
        ['valid', 'removed'],
        [
          { model: 'model-1', provider: 'provider-1', supportsTools: true },
          { model: 'judge-1', provider: 'provider-1', supportsTools: false },
        ],
      ),
    ).toEqual({ caseIds: [], contenders: [], judge: false });
  });
});
