import { $wrapNodeInElement } from '@lexical/utils';
import {
  $createParagraphNode,
  $insertNodes,
  $isRootOrShadowRoot,
  $nodesOfType,
  COMMAND_PRIORITY_HIGH,
  createCommand,
  type LexicalCommand,
  type LexicalEditor,
} from 'lexical';

import { $createActionTagNode, ActionTagNode } from './ActionTagNode';
import type { ActionTagCategory, ActionTagType } from './types';

export interface InsertActionTagPayload {
  category: ActionTagCategory;
  label: string;
  /** Keep at most one tag with this category and identifier in the current draft. */
  skipIfExists?: boolean;
  type: ActionTagType;
}

export const INSERT_ACTION_TAG_COMMAND: LexicalCommand<InsertActionTagPayload> = createCommand(
  'INSERT_ACTION_TAG_COMMAND',
);

export function registerActionTagCommand(editor: LexicalEditor): () => void {
  return editor.registerCommand(
    INSERT_ACTION_TAG_COMMAND,
    (payload) => {
      editor.update(() => {
        // Check the live update, not a cached snapshot, so rapid clicks are atomic
        // and removing a chip immediately allows it to be inserted again.
        if (
          payload.skipIfExists &&
          $nodesOfType(ActionTagNode).some(
            (node) => node.actionCategory === payload.category && node.actionType === payload.type,
          )
        ) {
          return;
        }

        const node = $createActionTagNode(payload.type, payload.category, payload.label);
        $insertNodes([node]);
        if ($isRootOrShadowRoot(node.getParentOrThrow())) {
          $wrapNodeInElement(node, $createParagraphNode).selectEnd();
        }
      });
      return true;
    },
    COMMAND_PRIORITY_HIGH,
  );
}
