import { useLexicalComposerContext } from '@lobehub/editor';
import { $getRoot, $isElementNode } from 'lexical';
import { type FC, useEffect } from 'react';

import { getTextDirectionFromFirstStrong } from '@/utils/textDirection';

const AUTO_DIR_TAG = 'chat-input-auto-direction';

/**
 * Sets each top-level block's Lexical direction from the first strong character.
 * Also clears a forced root `ltr` (from @lobehub/editor inode defaults) so
 * paragraphs can use auto / explicit rtl without inheriting LTR.
 */
const ReactAutoDirectionPlugin: FC = () => {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const lexicalEditor = editor.getLexicalEditor();
    if (!lexicalEditor) return;

    return lexicalEditor.registerUpdateListener(({ editorState, tags }) => {
      if (tags.has(AUTO_DIR_TAG)) return;

      let needsUpdate = false;

      editorState.read(() => {
        const root = $getRoot();
        if (root.getDirection() !== null) {
          needsUpdate = true;
          return;
        }

        for (const child of root.getChildren()) {
          if (!$isElementNode(child) || child.isInline()) continue;
          const next = getTextDirectionFromFirstStrong(child.getTextContent());
          if (child.getDirection() !== next) {
            needsUpdate = true;
            return;
          }
        }
      });

      if (!needsUpdate) return;

      lexicalEditor.update(
        () => {
          const root = $getRoot();
          if (root.getDirection() !== null) {
            root.setDirection(null);
          }

          for (const child of root.getChildren()) {
            if (!$isElementNode(child) || child.isInline()) continue;
            const next = getTextDirectionFromFirstStrong(child.getTextContent());
            if (child.getDirection() !== next) {
              child.setDirection(next);
            }
          }
        },
        { tag: AUTO_DIR_TAG },
      );
    });
  }, [editor]);

  return null;
};

ReactAutoDirectionPlugin.displayName = 'ReactAutoDirectionPlugin';

export default ReactAutoDirectionPlugin;
