import { type ComponentType, startTransition, useEffect, useState } from 'react';

import { type HomeEditorInputProps } from './EditorInput';

export type HomeEditorInputComponent = ComponentType<HomeEditorInputProps>;
export type HomeEditorInputLoader = () => Promise<{ default: HomeEditorInputComponent }>;

export const loadHomeEditorInput: HomeEditorInputLoader = () => import('./EditorInput');

export const useProgressiveEditor = (
  loadEditorInput: HomeEditorInputLoader = loadHomeEditorInput,
) => {
  const [EditorInput, setEditorInput] = useState<HomeEditorInputComponent>();
  const [isComposing, setIsComposing] = useState(false);

  useEffect(() => {
    let active = true;

    void loadEditorInput()
      .then(({ default: LoadedEditorInput }) => {
        if (!active) return;

        startTransition(() => {
          setEditorInput(() => LoadedEditorInput);
        });
      })
      .catch((error) => {
        if (active) console.error('[HomeInput] Failed to load the rich editor:', error);
      });

    return () => {
      active = false;
    };
  }, [loadEditorInput]);

  return {
    EditorInput,
    canRenderEditor: Boolean(EditorInput) && !isComposing,
    endComposition: () => setIsComposing(false),
    startComposition: () => setIsComposing(true),
  };
};
