import type { CompositionEventHandler } from 'react';

import type { HomeEditorInputProps } from './EditorInput';
import { getFallbackPlaceholder } from './getFallbackPlaceholder';
import InputFallback from './InputFallback';
import { useProgressiveEditor } from './useProgressiveEditor';

export const EditorSlot = (props: HomeEditorInputProps) => {
  const {
    initialValue,
    isAgentConfigLoading,
    loading,
    mode,
    onModeChange,
    onValueChange,
    placeholder,
  } = props;
  const { EditorInput, canRenderEditor, endComposition, startComposition } = useProgressiveEditor();
  const fallbackPlaceholder = getFallbackPlaceholder(placeholder);

  const handleCompositionEnd: CompositionEventHandler<HTMLTextAreaElement> = (event) => {
    // The final IME value can land on compositionend before React dispatches
    // the corresponding change event. Capture it before replacing the textarea.
    onValueChange(event.currentTarget.value);
    endComposition();
  };

  if (canRenderEditor && EditorInput) return <EditorInput {...props} />;

  return (
    <InputFallback
      isAgentConfigLoading={isAgentConfigLoading}
      loading={loading}
      mode={mode}
      placeholder={fallbackPlaceholder}
      value={initialValue}
      onCompositionEnd={handleCompositionEnd}
      onCompositionStart={startComposition}
      onModeChange={onModeChange}
      onValueChange={onValueChange}
    />
  );
};
