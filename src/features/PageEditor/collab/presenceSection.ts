import { $getNodeByKey, $isRootOrShadowRoot, type LexicalEditor, type NodeKey } from 'lexical';

export const getSectionTitle = (editor: LexicalEditor, nodeKey: NodeKey): string | undefined =>
  editor.getEditorState().read(() => {
    const node = $getNodeByKey(nodeKey);
    if (!node || $isRootOrShadowRoot(node)) return undefined;

    let block = node.getTopLevelElement();
    while (block) {
      if (block.getType() === 'heading') return block.getTextContent().trim() || undefined;
      block = block.getPreviousSibling();
    }
    return undefined;
  });
