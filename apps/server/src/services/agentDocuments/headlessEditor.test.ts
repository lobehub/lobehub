// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { isValidEditorData } from '@/libs/editor/isValidEditorData';

import {
  applyLiteXMLOperations,
  createAgentMarkdownSnapshot,
  createMarkdownEditorSnapshot,
  exportEditorDataSnapshot,
} from './headlessEditor';

const hasNodeType = (value: unknown, type: string): boolean => {
  if (!value || typeof value !== 'object') return false;

  if (!Array.isArray(value) && 'type' in value && value.type === type) return true;

  return Object.values(value).some((child) => {
    if (Array.isArray(child)) {
      return child.some((item) => hasNodeType(item, type));
    }

    return hasNodeType(child, type);
  });
};

const getSpanId = (litexml: string, text: string): string => {
  const match = litexml.match(new RegExp(`<span id="([^"]+)">${text}</span>`));
  expect(match).not.toBeNull();

  return match![1];
};

describe('agent document headless editor', () => {
  it('should create a valid empty snapshot for whitespace-only markdown', async () => {
    const snapshot = await createMarkdownEditorSnapshot(' \n ');

    expect(snapshot.content).toBe('');
    expect(isValidEditorData(snapshot.editorData)).toBe(true);
  });

  it('should keep inline dollar text as plain text while preserving block math', async () => {
    const snapshot = await createMarkdownEditorSnapshot(
      'Budget variable: $x$ and $100k\n\n$$\nE = mc^2\n$$',
    );

    expect(snapshot.content).toContain('Budget variable: $x$ and $100k');
    expect(hasNodeType(snapshot.editorData, 'math')).toBe(false);
    expect(hasNodeType(snapshot.editorData, 'mathBlock')).toBe(true);
  });

  it('should safely serialize concurrent headless document lifecycles', async () => {
    const sources = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        createMarkdownEditorSnapshot(
          `# Report ${index}\n\n| Supplier | Price |\n| --- | --- |\n${`| Vendor ${index} | $${index} |\n`.repeat(40)}`,
        ),
      ),
    );

    const snapshots = await Promise.all(
      sources.map((source) =>
        exportEditorDataSnapshot({
          editorData: source.editorData,
          fallbackContent: source.content,
          litexml: true,
        }),
      ),
    );

    snapshots.forEach((snapshot, index) => {
      expect(snapshot.content).toContain(`Report ${index}`);
      expect(snapshot.litexml).toContain(`Vendor ${index}`);
    });
  });

  it('should apply LiteXML operations and persist diff nodes for later human review', async () => {
    const initial = await exportEditorDataSnapshot({
      fallbackContent: 'Original',
      litexml: true,
    });
    const textId = getSpanId(initial.litexml!, 'Original');

    const snapshot = await applyLiteXMLOperations({
      editorData: initial.editorData,
      fallbackContent: initial.content,
      operations: [
        {
          action: 'modify',
          litexml: `<span id="${textId}">Updated</span>`,
        },
      ],
    });

    // Markdown and LiteXML exports are auto-normalized by the headless editor,
    // so they show the accepted view — this is what Context Engine injects and
    // what LLMs see when reading the document.
    expect(snapshot.content).toBe('Updated\n');
    expect(snapshot.litexml).toContain('Updated');

    // editorData (the persisted form) retains the diff node so the page editor
    // can render a review UI when the user next opens the document.
    expect(hasNodeType(snapshot.editorData, 'diff')).toBe(true);
  });

  it('should fall back to Markdown when valid editor data hydrates to an empty document', async () => {
    const empty = await createMarkdownEditorSnapshot('');

    const snapshot = await exportEditorDataSnapshot({
      editorData: empty.editorData,
      fallbackContent: 'Fallback content',
      litexml: true,
    });

    expect(snapshot.content).toBe('Fallback content\n');
    expect(snapshot.litexml).toContain('Fallback content');
    expect(snapshot.recoveredFromMarkdown).toBe(true);

    const textId = getSpanId(snapshot.litexml!, 'Fallback content');
    const modified = await applyLiteXMLOperations({
      editorData: snapshot.editorData,
      fallbackContent: snapshot.content,
      operations: [
        {
          action: 'modify',
          litexml: `<span id="${textId}">Updated after recovery</span>`,
        },
      ],
    });

    expect(modified.content).toBe('Updated after recovery\n');
  });

  it('should insert a LiteXML fragment with multiple top-level nodes', async () => {
    const initial = await exportEditorDataSnapshot({
      fallbackContent: 'Original',
      litexml: true,
    });
    const textId = getSpanId(initial.litexml!, 'Original');

    const snapshot = await applyLiteXMLOperations({
      editorData: initial.editorData,
      fallbackContent: initial.content,
      operations: [
        {
          action: 'insert',
          afterId: textId,
          litexml: '<h2>Evidence</h2><p>Verified</p>',
        },
      ],
    });

    expect(snapshot.content).toContain('## Evidence');
    expect(snapshot.content).toContain('Verified');
  });

  it('should reject a node edit that unexpectedly clears a non-empty document', async () => {
    const initial = await exportEditorDataSnapshot({
      fallbackContent: 'Original',
      litexml: true,
    });
    const textId = getSpanId(initial.litexml!, 'Original');

    await expect(
      applyLiteXMLOperations({
        editorData: initial.editorData,
        fallbackContent: initial.content,
        operations: [{ action: 'remove', id: textId }],
      }),
    ).rejects.toThrow('unexpectedly produced empty content');
  });

  it('should reject a node edit that targets an unknown node id', async () => {
    const initial = await exportEditorDataSnapshot({
      fallbackContent: 'Original',
      litexml: true,
    });

    await expect(
      applyLiteXMLOperations({
        editorData: initial.editorData,
        fallbackContent: initial.content,
        operations: [
          {
            action: 'insert',
            afterId: 'missing-node',
            litexml: '<p>New content</p>',
          },
        ],
      }),
    ).rejects.toThrow('Operation 1 of 1 (insert) failed: node "missing-node" not found');
  });

  describe('Markdown read/write round trip', () => {
    // What an agent does when it edits a document by rewriting it: read the
    // Markdown back, then send that same Markdown to replaceDocumentContent.
    const rewriteOwnExport = async (markdown: string) => {
      const created = await createAgentMarkdownSnapshot(markdown);
      const rewritten = await createAgentMarkdownSnapshot(created.content);
      const again = await createAgentMarkdownSnapshot(rewritten.content);

      return [created.content, rewritten.content, again.content];
    };

    it('keeps a bold literal asterisk bold instead of flattening it to five asterisks', async () => {
      const [read, reread] = await rewriteOwnExport(
        '| Code | Line |\n| --- | --- |\n| **\\*** | Operating result |\n| **\\*\\*** | Financial result |\n',
      );

      expect(read).toContain('**\\***');
      expect(read).not.toContain('\\*\\*\\*\\*\\*');
      expect(reread).toBe(read);
    });

    it('does not add a space after a bold label on every rewrite', async () => {
      const exports = await rewriteOwnExport('**Mission:**  scan every drive\n**Owner:** Eric');

      expect(new Set(exports).size).toBe(1);
      expect(exports[0]).toContain('**Mission:**  scan every drive');
    });

    it('keeps literal backslashes, underscores and tags in text', async () => {
      const editorData = {
        root: {
          children: [
            {
              children: [
                {
                  detail: 0,
                  format: 0,
                  mode: 'normal',
                  style: '',
                  text: 'path a\\*b, placeholder：__（影响已消化）"；其余：__（未知）, -m <model>',
                  type: 'text',
                  version: 1,
                },
              ],
              direction: 'ltr',
              format: '',
              indent: 0,
              type: 'paragraph',
              version: 1,
            },
          ],
          direction: 'ltr',
          format: '',
          indent: 0,
          type: 'root',
          version: 1,
        },
      };

      const exported = await exportEditorDataSnapshot({ editorData });
      const reimported = await createAgentMarkdownSnapshot(exported.content);

      expect(JSON.stringify(reimported.editorData)).toContain(
        JSON.stringify(
          'path a\\*b, placeholder：__（影响已消化）"；其余：__（未知）, -m <model>',
        ).slice(1, -1),
      );
      expect(JSON.stringify(reimported.editorData)).not.toContain('"format":1');
    });
  });
});
