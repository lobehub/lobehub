import { useUnmount } from 'ahooks';
import { useCallback, useRef, useState } from 'react';

import {
  applyProjectionFragmentEdit,
  getManagedProjectionFragment,
  getManagedProjectionFragmentNames,
  type ManagedProjection,
  parseProjectionFragmentDraft,
  serializeProjectionFragment,
} from '@/projection/devtools';

type ProjectionEditorPhase = 'applying' | 'error' | 'idle' | 'persisted';

interface ProjectionEditorState {
  draft: string;
  fragmentName: string;
  message: string | null;
  phase: ProjectionEditorPhase;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const createEditorState = (
  projection: ManagedProjection,
  fragmentName = getManagedProjectionFragmentNames(projection).at(0) ?? '',
): ProjectionEditorState => {
  const fragment = getManagedProjectionFragment(projection, fragmentName);
  if (!fragment) {
    return {
      draft: '',
      fragmentName,
      message: 'The selected fragment is no longer available.',
      phase: 'error',
    };
  }

  try {
    return {
      draft: serializeProjectionFragment(fragment.data),
      fragmentName,
      message: null,
      phase: 'idle',
    };
  } catch (error) {
    return { draft: '', fragmentName, message: errorMessage(error), phase: 'error' };
  }
};

export const useProjectionEditor = ({
  onPersisted,
  projection,
}: {
  onPersisted?: () => Promise<void> | void;
  projection: ManagedProjection;
}) => {
  const fragmentNames = getManagedProjectionFragmentNames(projection);
  const [state, setState] = useState<ProjectionEditorState>(() => createEditorState(projection));
  const requestIdRef = useRef(0);

  useUnmount(() => {
    requestIdRef.current += 1;
  });

  const selectFragment = useCallback(
    (fragmentName: string) => {
      requestIdRef.current += 1;
      setState(createEditorState(projection, fragmentName));
    },
    [projection],
  );

  const setDraft = useCallback((draft: string) => {
    setState((current) => ({ ...current, draft, message: null, phase: 'idle' }));
  }, []);

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    setState((current) => createEditorState(projection, current.fragmentName));
  }, [projection]);

  const apply = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setState((current) => ({ ...current, message: null, phase: 'applying' }));

    try {
      const data = parseProjectionFragmentDraft(state.draft);
      await applyProjectionFragmentEdit({ data, fragmentName: state.fragmentName, projection });
      await onPersisted?.();
      if (requestId !== requestIdRef.current) return;
      setState((current) => ({
        ...current,
        message: 'Applied to the live Projection and persisted to the local database.',
        phase: 'persisted',
      }));
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setState((current) => ({ ...current, message: errorMessage(error), phase: 'error' }));
    }
  }, [onPersisted, projection, state.draft, state.fragmentName]);

  return {
    ...state,
    apply,
    fragmentNames,
    isApplying: state.phase === 'applying',
    reset,
    selectFragment,
    setDraft,
  };
};
