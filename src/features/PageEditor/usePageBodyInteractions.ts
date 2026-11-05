import type { IEditor } from '@lobehub/editor';
import { mergeRegister } from 'lexical';
import { type RefObject, useEffect } from 'react';

import { registerClickBelowContentOnLexical } from './blankAreaClick';
import { findPageTitleInput, registerTitleBodyNavigationOnLexical } from './titleBodyNavigation';

/**
 * Wire the page body's own interactions into its Lexical editor: walking the
 * caret up into the title, and writing after the last block from a click on
 * the blank space below it. `hostRef` holds both the title and the body.
 *
 * Both check `isEditable()` per event, so a page that gets locked or unlocked
 * needs no re-registration.
 */
export const usePageBodyInteractions = (
  editor: IEditor | undefined,
  hostRef: RefObject<HTMLElement | null>,
) => {
  useEffect(() => {
    if (!editor) return;

    let disposed = false;
    let unregister: (() => void) | undefined;

    const attach = () => {
      const lexicalEditor = editor.getLexicalEditor?.();
      if (disposed || !lexicalEditor) return;

      // A document switch rebuilds the Lexical editor under the same kernel,
      // so drop the previous registrations before taking new ones.
      unregister?.();
      unregister = mergeRegister(
        registerClickBelowContentOnLexical(lexicalEditor),
        registerTitleBodyNavigationOnLexical(lexicalEditor, {
          getTitleInput: () => findPageTitleInput(hostRef.current),
          registerHighCommand: (command, listener, priority) =>
            editor.registerHighCommand(command, listener, priority),
        }),
      );
    };

    // The body only mounts once its content request resolves, so the Lexical
    // editor may not exist yet; wait for the kernel's own signal.
    editor.on('initialized', attach);
    attach();

    return () => {
      disposed = true;
      editor.off('initialized', attach);
      unregister?.();
    };
  }, [editor, hostRef]);
};
