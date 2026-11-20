import { useEffect, useRef, useState } from 'react';

import {
  applyPresetDataset,
  type ExperimentDraft,
  experimentDraftKey,
  experimentDraftLocationKey,
  parseExperimentDraft,
} from './experimentDraft';

interface DraftOptions {
  benchmarkIds: string[];
  getInitialDraft: (benchmarkId: string) => ExperimentDraft;
  initialBenchmarkId?: string;
  presetDatasetId?: string | null;
  ready: boolean;
  userId?: string;
  workspaceId: string | null;
}

interface DraftSession {
  benchmarkId: string;
  context: string;
  draft: ExperimentDraft;
  restored: boolean;
  storageError: boolean;
}

export const useExperimentDraft = (options: DraftOptions) => {
  const { initialBenchmarkId, presetDatasetId, ready, userId, workspaceId } = options;
  const context =
    userId && initialBenchmarkId
      ? JSON.stringify([userId, workspaceId, initialBenchmarkId, presetDatasetId ?? null])
      : undefined;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const sessionRef = useRef<DraftSession | undefined>(undefined);
  const [session, setSession] = useState<DraftSession>();

  const publish = (next: DraftSession) => {
    sessionRef.current = next;
    setSession(next);
  };

  const readDraft = (
    benchmarkId: string,
    datasetId?: string | null,
  ): Pick<DraftSession, 'draft' | 'restored' | 'storageError'> => {
    const initial = optionsRef.current.getInitialDraft(benchmarkId);
    try {
      const stored = parseExperimentDraft(
        localStorage.getItem(experimentDraftKey({ benchmarkId, userId: userId!, workspaceId })),
      );
      return {
        draft: applyPresetDataset(stored ?? initial, datasetId),
        restored: !!stored,
        storageError: false,
      };
    } catch {
      return { draft: applyPresetDataset(initial, datasetId), restored: false, storageError: true };
    }
  };

  useEffect(() => {
    if (
      !ready ||
      !context ||
      !initialBenchmarkId ||
      !userId ||
      sessionRef.current?.context === context
    )
      return;
    let benchmarkId = initialBenchmarkId;
    let storageError = false;
    // Remember the last edited benchmark so a generic Back/reload restores the same form.
    if (!presetDatasetId) {
      try {
        const previous = localStorage.getItem(experimentDraftLocationKey(userId, workspaceId));
        if (previous && optionsRef.current.benchmarkIds.includes(previous)) benchmarkId = previous;
      } catch {
        storageError = true;
      }
    }
    const restored = readDraft(benchmarkId, presetDatasetId);
    publish({
      ...restored,
      benchmarkId,
      context,
      storageError: storageError || restored.storageError,
    });
  }, [context, initialBenchmarkId, presetDatasetId, ready, userId, workspaceId]);

  const current = session?.context === context ? session : undefined;
  const updateDraft = (
    update: Partial<ExperimentDraft> | ((draft: ExperimentDraft) => ExperimentDraft),
  ) => {
    const previous = sessionRef.current;
    if (!previous || previous.context !== context || !userId) return;
    const draft =
      typeof update === 'function' ? update(previous.draft) : { ...previous.draft, ...update };
    let storageError = false;
    try {
      // Save in the event, before navigation can unmount this page.
      localStorage.setItem(
        experimentDraftKey({ benchmarkId: previous.benchmarkId, userId, workspaceId }),
        JSON.stringify(draft),
      );
      localStorage.setItem(experimentDraftLocationKey(userId, workspaceId), previous.benchmarkId);
    } catch {
      storageError = true;
    }
    publish({ ...previous, draft, storageError });
  };

  const selectDataset = (benchmarkId: string, datasetId: string) => {
    const previous = sessionRef.current;
    if (!previous || previous.context !== context) return;
    if (benchmarkId !== previous.benchmarkId) {
      publish({ ...readDraft(benchmarkId, datasetId), benchmarkId, context: previous.context });
    }
    updateDraft((draft) => applyPresetDataset(draft, datasetId));
  };

  /** Call only after all runs have started, or when the user explicitly discards the draft. */
  const clearDraft = (reset = false) => {
    const previous = sessionRef.current;
    if (!previous || previous.context !== context || !userId) return;
    let storageError = false;
    try {
      localStorage.removeItem(
        experimentDraftKey({ benchmarkId: previous.benchmarkId, userId, workspaceId }),
      );
      localStorage.removeItem(experimentDraftLocationKey(userId, workspaceId));
    } catch {
      storageError = true;
    }
    publish({
      ...previous,
      draft: reset
        ? applyPresetDataset(
            optionsRef.current.getInitialDraft(previous.benchmarkId),
            previous.benchmarkId === initialBenchmarkId ? presetDatasetId : undefined,
          )
        : previous.draft,
      restored: false,
      storageError,
    });
  };

  return {
    clearDraft,
    draft: current?.draft,
    ready: !!current,
    restored: current?.restored ?? false,
    selectDataset,
    storageError: current?.storageError ?? false,
    updateDraft,
  };
};
