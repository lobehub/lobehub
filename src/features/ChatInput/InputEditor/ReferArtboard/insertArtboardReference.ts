import { useChatStore } from '@/store/chat';

import { INSERT_ARTBOARD_REFERENCE_COMMAND } from './ReferArtboardPlugin';
import type { ArtboardReference } from './serialize';

export const insertArtboardReference = (reference: ArtboardReference) => {
  const editor = useChatStore.getState().mainInputEditor;
  if (!editor?.instance) return false;
  editor.instance.dispatchCommand(INSERT_ARTBOARD_REFERENCE_COMMAND, reference);
  editor.focus();
  return true;
};
