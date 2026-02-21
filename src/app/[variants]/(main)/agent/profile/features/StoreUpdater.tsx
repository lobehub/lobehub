'use client';

import { useEditorState } from '@lobehub/editor/react';
import { memo, useEffect } from 'react';

import { type PublicState } from './store';
import { useProfileStore, useStoreApi } from './store';

export type StoreUpdaterProps = Partial<PublicState>;

const StoreUpdater = memo<StoreUpdaterProps>(() => {
  const storeApi = useStoreApi();

  const editor = useProfileStore((s) => s.editor);
  const editorState = useEditorState(editor);

  // Update editorState in store
  useEffect(() => {
    storeApi.setState({ editorState });
  }, [editorState, storeApi]);

  return null;
});

export default StoreUpdater;
