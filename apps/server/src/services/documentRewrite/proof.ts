import { createHeadlessEditor } from '@lobehub/editor/headless';
import type { SerializedLexicalNode } from 'lexical';
import { $getRoot, $insertNodes, $isTextNode, $parseSerializedNode } from 'lexical';

const getSerializedTextContent = (node: unknown, seen = new WeakSet<object>()): string => {
  if (typeof node !== 'object' || node === null || seen.has(node)) return '';
  seen.add(node);
  if (Array.isArray(node))
    return node.map((child) => getSerializedTextContent(child, seen)).join('');

  const record = node as { children?: unknown; text?: unknown; type?: unknown };
  if (record.type === 'cursor') return '';
  if (typeof record.text === 'string') return record.text;
  return getSerializedTextContent(record.children, seen);
};

const normalizeMarkdownProof = (markdown: string): string => markdown.replaceAll(/\r\n?/g, '\n');

const normalizeProofText = (): void => {
  const texts = $getRoot().getAllTextNodes();
  for (const node of texts) node.setFormat(0).setDetail(0).setMode('normal').setStyle('');
  // Streaming provenance can keep adjacent text fragments separate. The
  // Markdown writer inserts spacing between such fragments, so normalize
  // their boundaries in this disposable proof editor without changing text
  // or crossing links, paragraphs, or source-backed nodes.
  for (const node of texts) {
    if (!node.isAttached() || node.getType() !== 'text') continue;
    let next = node.getNextSibling();
    while ($isTextNode(next) && next.getType() === 'text') {
      node.mergeWithSibling(next);
      next = node.getNextSibling();
    }
  }
};

const exportWithoutTextPresentation = (editor: ReturnType<typeof createHeadlessEditor>): string => {
  const lexical = editor.kernel.getLexicalEditor();
  if (!lexical) return '';
  lexical.update(normalizeProofText, { discrete: true });
  return normalizeMarkdownProof(editor.export().markdown);
};

const normalizeLegacyCodeNode = (node: SerializedLexicalNode): SerializedLexicalNode => {
  if (
    typeof node !== 'object' ||
    node === null ||
    node.type !== 'code' ||
    typeof (node as { code?: unknown }).code !== 'string' ||
    Array.isArray((node as { children?: unknown }).children)
  ) {
    return node;
  }
  const normalizer = createHeadlessEditor();
  try {
    normalizer.hydrateEditorData({
      root: { children: [node], type: 'root', version: 1 },
    } as Parameters<typeof normalizer.hydrateEditorData>[0]);
    const normalized = normalizer
      .export()
      .editorData.root.children.find((candidate) => candidate.type === 'code');
    return normalized ?? node;
  } catch {
    return node;
  } finally {
    normalizer.destroy();
  }
};

/**
 * Normalize a request-owned node forest with the editor's own Lexical parser
 * and insertion path. This intentionally does not maintain a node-type
 * catalog: CodeNode, tables, links, and future nodes all use their registered
 * import/export behavior.
 */
const exportGeneratedForestMarkdown = (editorData: unknown): string => {
  const editor = createHeadlessEditor();
  try {
    editor.hydrateMarkdown('proof-placeholder');
    const root = (editorData as { root?: { children?: unknown[] } } | undefined)?.root;
    const serializedNodes = Array.isArray(root?.children)
      ? root.children.filter((node): node is SerializedLexicalNode => Boolean(node))
      : [];
    const lexical = editor.kernel.getLexicalEditor();
    if (!lexical) return '';
    lexical.update(
      () => {
        const lexicalRoot = $getRoot();
        lexicalRoot.clear();
        lexicalRoot.selectEnd();
        $insertNodes(
          serializedNodes.map((node) => $parseSerializedNode(normalizeLegacyCodeNode(node))),
        );
        normalizeProofText();
      },
      { discrete: true },
    );
    return editor.export().markdown;
  } finally {
    editor.destroy();
  }
};

/**
 * Compare complete generated Markdown through the editor's parser/importer/
 * exporter. The persisted text projection guards inherited presentation
 * containers; the normalized forest guards opaque payloads without a field
 * catalog.
 */
export const canonicalizeGeneratedMarkdownProof = (
  editorData: unknown,
  outputText: string,
  persistedText = '',
): boolean => {
  const outputEditor = createHeadlessEditor();
  try {
    outputEditor.hydrateMarkdown(outputText);
    const expectedMarkdown = exportWithoutTextPresentation(outputEditor);
    const persistedTextProjection = getSerializedTextContent(
      (editorData as { root?: unknown } | undefined)?.root,
    );
    if (normalizeMarkdownProof(persistedText) !== normalizeMarkdownProof(persistedTextProjection)) {
      return false;
    }
    const persistedMarkdown = normalizeMarkdownProof(exportGeneratedForestMarkdown(editorData));
    return persistedMarkdown === expectedMarkdown;
  } catch {
    return false;
  } finally {
    outputEditor.destroy();
  }
};
