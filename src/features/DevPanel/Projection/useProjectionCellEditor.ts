import { useCallback, useEffect, useRef, useState } from 'react';

import {
  applyProjectionCellEdit,
  parseProjectionCellDraft,
  serializeProjectionCellDraft,
} from '@/projection/devtools';

import type { ProjectionTableCell } from './model';

export interface ProjectionCellEditFeedback {
  message: string;
  status: 'editing' | 'error' | 'idle' | 'saved';
}

type ProjectionCellEditorPhase = 'applying' | 'editing' | 'idle';

interface ProjectionCellEditorState {
  activeCell: ProjectionTableCell | null;
  draft: string;
  error: string | null;
  initialDraft: string;
  phase: ProjectionCellEditorPhase;
}

const INITIAL_STATE: ProjectionCellEditorState = {
  activeCell: null,
  draft: '',
  error: null,
  initialDraft: '',
  phase: 'idle',
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const useProjectionCellEditor = ({
  onFeedback,
}: {
  onFeedback?: (feedback: ProjectionCellEditFeedback) => void;
} = {}) => {
  const [state, setState] = useState<ProjectionCellEditorState>(INITIAL_STATE);
  const stateRef = useRef(state);
  const commitRef = useRef<Promise<boolean> | null>(null);
  const mountedRef = useRef(true);

  const updateState = useCallback(
    (
      update:
        | ProjectionCellEditorState
        | ((current: ProjectionCellEditorState) => ProjectionCellEditorState),
    ) => {
      const next = typeof update === 'function' ? update(stateRef.current) : update;
      stateRef.current = next;
      setState(next);
    },
    [],
  );

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const commit = useCallback(async (): Promise<boolean> => {
    if (commitRef.current) return commitRef.current;

    const snapshot = stateRef.current;
    const cell = snapshot.activeCell;
    const target = cell?.editTarget;
    if (!cell || !target) return true;

    const request = (async () => {
      if (snapshot.draft === snapshot.initialDraft) {
        if (mountedRef.current && stateRef.current.activeCell?.key === cell.key) {
          updateState(INITIAL_STATE);
        }
        onFeedback?.({ message: 'No changes.', status: 'idle' });
        return true;
      }

      updateState((current) => ({ ...current, error: null, phase: 'applying' }));

      try {
        const value = parseProjectionCellDraft(snapshot.draft, cell.value);
        await applyProjectionCellEdit({ target, value });
        if (mountedRef.current && stateRef.current.activeCell?.key === cell.key) {
          updateState(INITIAL_STATE);
        }
        onFeedback?.({ message: `Saved ${cell.column.label}.`, status: 'saved' });
        return true;
      } catch (error) {
        const message = errorMessage(error);
        if (mountedRef.current && stateRef.current.activeCell?.key === cell.key) {
          updateState((current) => ({ ...current, error: message, phase: 'editing' }));
        }
        onFeedback?.({ message, status: 'error' });
        return false;
      }
    })();

    commitRef.current = request;
    try {
      return await request;
    } finally {
      commitRef.current = null;
    }
  }, [onFeedback, updateState]);

  const begin = useCallback(
    async (cell: ProjectionTableCell, { pretty = false }: { pretty?: boolean } = {}) => {
      if (!cell.editTarget || stateRef.current.activeCell?.key === cell.key) return;

      if (stateRef.current.activeCell) {
        const committed = await commit();
        if (!committed || !mountedRef.current) return;
      }

      try {
        const draft = serializeProjectionCellDraft(cell.value, pretty);
        updateState({
          activeCell: cell,
          draft,
          error: null,
          initialDraft: draft,
          phase: 'editing',
        });
        onFeedback?.({
          message: `Editing ${cell.column.label}. Enter to save · Esc to cancel.`,
          status: 'editing',
        });
      } catch (error) {
        onFeedback?.({ message: errorMessage(error), status: 'error' });
      }
    },
    [commit, onFeedback, updateState],
  );

  const cancel = useCallback(() => {
    if (stateRef.current.phase === 'applying') return;
    updateState(INITIAL_STATE);
    onFeedback?.({ message: 'Edit cancelled.', status: 'idle' });
  }, [onFeedback, updateState]);

  const setDraft = useCallback(
    (draft: string) => {
      updateState((current) => ({ ...current, draft, error: null }));
    },
    [updateState],
  );

  return {
    ...state,
    begin,
    cancel,
    commit,
    isApplying: state.phase === 'applying',
    setDraft,
  };
};

export type ProjectionCellEditorController = Pick<
  ReturnType<typeof useProjectionCellEditor>,
  'activeCell' | 'begin' | 'cancel' | 'commit' | 'draft' | 'error' | 'isApplying' | 'setDraft'
>;
