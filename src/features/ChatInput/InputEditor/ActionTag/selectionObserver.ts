import { $getSelection, $isNodeSelection, $isRangeSelection, type LexicalEditor } from 'lexical';

import { $isActionTagNode } from './ActionTagNode';

export function registerActionTagSelectionObserver(editor: LexicalEditor): () => void {
  let selectedKeys: string[] = [];

  return editor.registerUpdateListener(({ editorState }) => {
    const selection = editorState.read(() => $getSelection());
    const newKeys: string[] = [];

    if ($isNodeSelection(selection)) {
      editorState.read(() => {
        for (const node of selection.getNodes()) {
          if ($isActionTagNode(node)) {
            newKeys.push(node.getKey());
          }
        }
      });
    } else if ($isRangeSelection(selection) && !selection.isCollapsed()) {
      editorState.read(() => {
        for (const node of selection.getNodes()) {
          if ($isActionTagNode(node)) {
            newKeys.push(node.getKey());
          }
        }
      });
    }

    const removeKeys = selectedKeys.filter((key) => !newKeys.includes(key));
    const addKeys = newKeys.filter((key) => !selectedKeys.includes(key));
    selectedKeys = [...newKeys];

    for (const key of removeKeys) {
      editor.getElementByKey(key)?.classList.remove('selected');
    }
    for (const key of addKeys) {
      editor.getElementByKey(key)?.classList.add('selected');
    }
  });
}
