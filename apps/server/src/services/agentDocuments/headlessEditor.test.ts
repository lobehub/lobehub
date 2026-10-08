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

  it('should keep a review diff for a replaced top-level block', async () => {
    const initial = await exportEditorDataSnapshot({
      fallbackContent: 'Original',
      litexml: true,
    });
    const blockId = initial.litexml!.match(/<p id="(\w+)">/)![1];

    const snapshot = await applyLiteXMLOperations({
      editorData: initial.editorData,
      fallbackContent: initial.content,
      operations: [
        {
          action: 'modify',
          litexml: `<p id="${blockId}"><span>Updated</span></p>`,
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

  it('should apply an inline edit directly so the block keeps its id', async () => {
    const initial = await exportEditorDataSnapshot({
      fallbackContent: 'Original',
      litexml: true,
    });
    const blockId = initial.litexml!.match(/<p id="(\w+)">/)![1];
    const textId = getSpanId(initial.litexml!, 'Original');

    const snapshot = await applyLiteXMLOperations({
      editorData: initial.editorData,
      fallbackContent: initial.content,
      operations: [{ action: 'modify', litexml: `<span id="${textId}">Updated</span>` }],
    });

    expect(snapshot.content).toBe('Updated\n');
    expect(snapshot.litexml).toContain(`<p id="${blockId}">`);
    expect(hasNodeType(snapshot.editorData, 'diff')).toBe(false);
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

  describe('LiteXML that is not well-formed', () => {
    // Fragment from a real modifyNodes insert that was reported as
    // "the editor rejected it": the text holds a raw `<model>`.
    const fragment =
      '<h2>404 真因</h2><ol><li>填成 https://api.deepseek.com/v1，请求打到 /v1/messages。</li><li>lh provider test -m <model> 能把“模型 ID 是否有效”变成回执。</li></ol>';

    const lastParagraphId = async () => {
      const initial = await exportEditorDataSnapshot({
        fallbackContent: 'first\n\nlast',
        litexml: true,
      });
      const ids = [...initial.litexml!.matchAll(/<p id="([^"]+)"/g)].map((match) => match[1]);

      return { afterId: ids.at(-1)!, initial };
    };

    it('names the unclosed tag and how to escape it instead of "the editor rejected it"', async () => {
      const { afterId, initial } = await lastParagraphId();

      const attempt = applyLiteXMLOperations({
        editorData: initial.editorData,
        operations: [{ action: 'insert', afterId, litexml: fragment }],
      });

      await expect(attempt).rejects.toThrow(
        'Operation 1 of 1 (insert) failed: litexml is not well-formed XML (<model> is never closed)',
      );
      await expect(attempt).rejects.toThrow('"&lt;"');
      await expect(attempt).rejects.not.toThrow('the editor rejected it');
    });

    it('applies the same fragment once the text escapes "<", bare URL included', async () => {
      const { afterId, initial } = await lastParagraphId();

      const result = await applyLiteXMLOperations({
        editorData: initial.editorData,
        operations: [
          { action: 'insert', afterId, litexml: fragment.replace('<model>', '&lt;model&gt;') },
        ],
      });

      expect(result.content).toContain('https://api.deepseek.com/v1');
      expect(result.content).toContain('<model>');
    });
  });

  describe('raw JSON content', () => {
    // Shape of a real createDocument body: a JSON lorebook whose strings hold
    // escaped quotes, `\n` and a `__` placeholder.
    const json = JSON.stringify(
      {
        entries: [
          {
            content: '维护"谁知道什么"的全表。\n压缩办法：压成"背景事件：__（影响已消化）"一行。',
            key: ['曝光', '知道'],
          },
          { content: '其余在校人员：__（不知情）', key: [] },
        ],
      },
      null,
      2,
    );

    it('rejects raw JSON with a way to store it verbatim instead of rewriting it', async () => {
      // Markdown alone drops the escapes and pairs the placeholders into bold.
      const markdown = await createMarkdownEditorSnapshot(json);
      expect(() => JSON.parse(markdown.content)).toThrow();

      await expect(createAgentMarkdownSnapshot(json)).rejects.toThrow(
        /raw JSON.*Nothing was saved\. Wrap the JSON in a fenced code block/,
      );
    });

    it('stores the same JSON byte-exact inside a json code fence', async () => {
      const fenced = `\`\`\`json\n${json}\n\`\`\``;
      const snapshot = await createAgentMarkdownSnapshot(fenced);
      const body = snapshot.content.match(/```json\n([\S\s]*?)\n```/)?.[1];

      expect(body).toBe(json);
      expect((await createAgentMarkdownSnapshot(snapshot.content)).content).toBe(snapshot.content);
    });

    it('keeps accepting Markdown that only starts like JSON', async () => {
      await expect(
        createAgentMarkdownSnapshot('[link](https://example.com) text'),
      ).resolves.toBeDefined();
      await expect(createAgentMarkdownSnapshot('{draft} notes')).resolves.toBeDefined();
    });
  });
});
