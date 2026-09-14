'use client';

import { useLexicalEditor } from '@lobehub/editor';
import { $getSelection, COLLABORATION_TAG } from 'lexical';
import { memo } from 'react';

import { capturePageCaretRect, createPageScrollAnchoring } from './collaborationScrollAnchoring';

interface PageScrollAnchoringPluginProps {
  enabled?: boolean;
}

const PageScrollAnchoringPlugin = memo<PageScrollAnchoringPluginProps>(({ enabled = false }) => {
  useLexicalEditor(
    (lexicalEditor) => {
      if (!enabled) return;
      const root = lexicalEditor.getRootElement();
      if (!root) return;

      const controller = createPageScrollAnchoring({
        getCaretRect: () => {
          if (!lexicalEditor.isEditable()) return null;
          let hasLocalSelection = false;
          lexicalEditor.getEditorState().read(() => {
            hasLocalSelection = Boolean($getSelection());
          });
          return hasLocalSelection ? capturePageCaretRect(root) : null;
        },
        root,
      });
      const unregisterUpdateListener = lexicalEditor.registerUpdateListener(({ tags }) => {
        if (tags.has(COLLABORATION_TAG)) {
          controller.handleRemoteUpdate();
        } else {
          // A local selection/edit establishes a new baseline and must never
          // be compensated as if it were an Agent update.
          controller.refresh();
        }
      });

      return () => {
        unregisterUpdateListener();
        controller.dispose();
      };
    },
    [enabled],
  );

  return null;
});

PageScrollAnchoringPlugin.displayName = 'PageScrollAnchoringPlugin';

export default PageScrollAnchoringPlugin;
