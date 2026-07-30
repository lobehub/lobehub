import type { HomeEditorInputProps } from './EditorInput';
import EditorInput from './EditorInput';

/** Electron loads the renderer from the local app package, so the Home editor is available eagerly. */
export const EditorSlot = (props: HomeEditorInputProps) => <EditorInput {...props} />;
