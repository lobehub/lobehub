import type { IEditor } from '@lobehub/editor';
import { $getSelection, $isRangeSelection, type LexicalEditor, type LexicalNode } from 'lexical';

interface LiteXMLDataSource {
  nodesToXML?: (node: LexicalNode, lines: string[], indent?: number) => void;
}

interface InspectableEditor {
  dataTypeMap?: Map<string, unknown> | Record<string, unknown>;
  getLexicalEditor?: () => LexicalEditor | null;
}

// getSelectionDocument('litexml') re-parses the selected nodes into a fresh
// state, so its ids never match the page's. Serializing the live top-level
// blocks with the page's own LiteXML writer keeps the ids the agent sees in
// /doc.xml.
export const getSelectedBlocksLiteXML = (editor: IEditor): string | undefined => {
  const { dataTypeMap, getLexicalEditor } = editor as InspectableEditor;
  const dataSource = (
    dataTypeMap instanceof Map ? dataTypeMap.get('litexml') : dataTypeMap?.litexml
  ) as LiteXMLDataSource | undefined;
  const lexical = getLexicalEditor?.call(editor);
  if (!lexical || !dataSource?.nodesToXML) return;

  return lexical.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || selection.isCollapsed()) return;

    const blocks = new Set(selection.getNodes().map((node) => node.getTopLevelElement() ?? node));
    const lines: string[] = [];
    for (const block of blocks) dataSource.nodesToXML!.call(dataSource, block, lines, 1);

    return lines.length > 0 ? `<root>\n${lines.join('\n')}\n</root>` : undefined;
  });
};
