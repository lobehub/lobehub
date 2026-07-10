import { describe, expect, it } from 'vitest';

import { stripMarkdown } from './stripMarkdown';

describe('stripMarkdown', () => {
  it('should remove heading markers', () => {
    expect(stripMarkdown('# Title')).toBe('Title');
    expect(stripMarkdown('## Subtitle')).toBe('Subtitle');
    expect(stripMarkdown('### H3')).toBe('H3');
  });

  it('should remove bold formatting', () => {
    expect(stripMarkdown('**bold text**')).toBe('bold text');
    expect(stripMarkdown('__bold text__')).toBe('bold text');
  });

  it('should remove italic formatting', () => {
    expect(stripMarkdown('*italic text*')).toBe('italic text');
    expect(stripMarkdown('some _italic_ here')).toBe('some italic here');
  });

  it('should remove bold+italic formatting', () => {
    expect(stripMarkdown('***bold italic***')).toBe('bold italic');
  });

  it('should remove strikethrough', () => {
    expect(stripMarkdown('~~deleted~~')).toBe('deleted');
  });

  it('should remove inline code backticks', () => {
    expect(stripMarkdown('run `npm install` now')).toBe('run npm install now');
  });

  it('should remove fenced code block markers but keep content', () => {
    const input = '```typescript\nconst x = 1;\n```';
    expect(stripMarkdown(input)).toBe('const x = 1;');
  });

  it('should not inject extra blank lines after a fenced code block', () => {
    // Before the fix, the captured code content carried a trailing \n that
    // stacked with the \n\n after the closing fence → two blank lines.
    const input = ['```js', 'a', 'b', '```', '', 'next'].join('\n');
    expect(stripMarkdown(input)).toBe('a\nb\n\nnext');
  });

  it('should not mangle markdown-like syntax inside code blocks', () => {
    // Content inside a fenced code block must survive verbatim — no heading /
    // table / emphasis rewriting should be applied to it.
    const input = ['```md', '# Not a heading', '**not bold**', '| a | b |', '```'].join('\n');
    const result = stripMarkdown(input);
    expect(result).toContain('# Not a heading');
    expect(result).toContain('**not bold**');
    expect(result).toContain('| a | b |');
  });

  it('should convert links to text (url) format', () => {
    expect(stripMarkdown('[Click here](https://example.com)')).toBe(
      'Click here (https://example.com)',
    );
  });

  it('should convert images to alt text', () => {
    expect(stripMarkdown('![alt text](https://img.png)')).toBe('alt text');
  });

  it('should convert blockquotes to vertical bar', () => {
    expect(stripMarkdown('> quoted text')).toBe('| quoted text');
  });

  describe('tables', () => {
    it('should convert narrow tables (2–3 cols) to single-line records', () => {
      const input = '| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |';
      const result = stripMarkdown(input);
      expect(result).toContain('- Name: Alice, Age: 30');
      expect(result).toContain('- Name: Bob, Age: 25');
    });

    it('should render single-column tables as a plain bullet list', () => {
      const input = '| Item |\n|------|\n| Apple |\n| Banana |';
      const result = stripMarkdown(input);
      expect(result).toBe('- Apple\n- Banana');
    });

    it('should render wide tables (4+ cols) as multi-line record blocks', () => {
      const input = [
        '| 姓名 | 年龄 | 职位 | 城市 |',
        '|------|------|------|------|',
        '| Alice | 30 | 工程师 | 上海 |',
        '| Bob | 25 | 设计师 | 北京 |',
      ].join('\n');
      const result = stripMarkdown(input);
      expect(result).toContain('【1】');
      expect(result).toContain('姓名: Alice');
      expect(result).toContain('年龄: 30');
      expect(result).toContain('职位: 工程师');
      expect(result).toContain('城市: 上海');
      expect(result).toContain('【2】');
      expect(result).toContain('姓名: Bob');
    });

    it('should handle escaped pipes inside cells', () => {
      const input = '| Key | Value |\n|-----|-------|\n| pipe | a \\| b |';
      const result = stripMarkdown(input);
      expect(result).toContain('- Key: pipe, Value: a | b');
    });

    it('should skip empty cells without emitting stray "header: " fragments', () => {
      const input = '| Name | Age |\n|------|-----|\n| Alice |  |\n|  | 25 |';
      const result = stripMarkdown(input);
      expect(result).toContain('- Name: Alice');
      expect(result).toContain('- Age: 25');
      expect(result).not.toContain('Age: \n');
      expect(result).not.toContain('Name: ,');
    });

    it('should not treat a pipe-only line as a table', () => {
      // `|--|` without a preceding header row should not trigger table parsing.
      const input = 'just a line with | pipe characters |\nand another | one |';
      const result = stripMarkdown(input);
      expect(result).toBe(input);
    });

    it('should preserve the blank line between a table and the following block', () => {
      // Before the fix, the body-row regex ate the trailing \n after the last
      // row, collapsing the blank separator before the next heading.
      const input = ['| a | b |', '|---|---|', '| 1 | 2 |', '', '## Next'].join('\n');
      const result = stripMarkdown(input);
      expect(result).toBe('- a: 1, b: 2\n\nNext');
    });
  });

  describe('lists', () => {
    it('should preserve unordered list markers', () => {
      const input = '- Apple\n- Banana\n- Cherry';
      expect(stripMarkdown(input)).toBe('- Apple\n- Banana\n- Cherry');
    });

    it('should preserve ordered list markers', () => {
      const input = '1. First\n2. Second\n3. Third';
      expect(stripMarkdown(input)).toBe('1. First\n2. Second\n3. Third');
    });

    it('should preserve nested list indentation', () => {
      const input = '- Parent\n  - Child A\n  - Child B';
      expect(stripMarkdown(input)).toBe('- Parent\n  - Child A\n  - Child B');
    });

    it('should strip inline formatting inside list items', () => {
      const input =
        '- Run `npm install`\n- Visit [docs](https://example.com)\n- **Important** note';
      const result = stripMarkdown(input);
      expect(result).toContain('- Run npm install');
      expect(result).toContain('- Visit docs (https://example.com)');
      expect(result).toContain('- Important note');
    });
  });

  describe('horizontal rules', () => {
    it('should normalize dash HR', () => {
      expect(stripMarkdown('---')).toBe('---');
    });

    it('should normalize asterisk HR', () => {
      expect(stripMarkdown('***')).toBe('---');
    });

    it('should normalize underscore HR', () => {
      expect(stripMarkdown('___')).toBe('---');
    });

    it('should not swallow the blank line after a horizontal rule', () => {
      // A trailing `\s*` in the HR regex would greedily eat the newline after
      // `---`, collapsing the intended blank-line separator.
      expect(stripMarkdown('before\n\n---\n\nafter')).toBe('before\n\n---\n\nafter');
    });
  });

  describe('mixed inline formatting', () => {
    it('should handle bold wrapping italic', () => {
      expect(stripMarkdown('**bold _italic_**')).toBe('bold italic');
    });

    it('should handle multiple emphases on one line', () => {
      expect(stripMarkdown('A **bold** and *italic* and `code` here')).toBe(
        'A bold and italic and code here',
      );
    });

    it('should not treat underscores inside identifiers as italic', () => {
      // `some_snake_case` has underscores flanked by word chars, not whitespace —
      // the italic rule must leave these alone or we'd mangle code/variable names.
      expect(stripMarkdown('some_snake_case variable')).toBe('some_snake_case variable');
    });
  });

  describe('structure preservation', () => {
    it('should preserve blank lines between paragraphs', () => {
      const input = 'First paragraph.\n\nSecond paragraph.';
      expect(stripMarkdown(input)).toBe(input);
    });

    it('should pass through emoji and Chinese unchanged', () => {
      expect(stripMarkdown('你好 世界 🎉 **重点**')).toBe('你好 世界 🎉 重点');
    });

    it('should handle a realistic LLM response with table + code + list', () => {
      const input = [
        '# 功能对比 🎯',
        '',
        '这里是 **三款工具** 的对比:',
        '',
        '| 工具 | 价格 |',
        '|------|------|',
        '| A 工具 | 免费 |',
        '| B 工具 | $10 |',
        '',
        '## 推荐',
        '',
        '1. 先试试 *免费* 的 A',
        '2. 详见 [文档](https://example.com)',
        '',
        '```bash',
        'npm install a-tool',
        '```',
      ].join('\n');

      const result = stripMarkdown(input);
      expect(result).not.toContain('**');
      expect(result).not.toContain('```');
      expect(result).not.toMatch(/^#\s/m);
      expect(result).toContain('功能对比 🎯');
      expect(result).toContain('三款工具');
      expect(result).toContain('- 工具: A 工具, 价格: 免费');
      expect(result).toContain('- 工具: B 工具, 价格: $10');
      expect(result).toContain('1. 先试试 免费 的 A');
      expect(result).toContain('2. 详见 文档 (https://example.com)');
      expect(result).toContain('npm install a-tool');
    });
  });

  it('should handle a complex mixed markdown document', () => {
    const input = [
      '# Hello World',
      '',
      'This is **bold** and *italic* text.',
      '',
      '- item 1',
      '- item 2',
      '',
      '```js',
      'console.log("hi");',
      '```',
      '',
      '[Link](https://example.com)',
    ].join('\n');

    const result = stripMarkdown(input);
    expect(result).not.toContain('**');
    expect(result).not.toContain('```');
    expect(result).not.toContain('# ');
    expect(result).toContain('Hello World');
    expect(result).toContain('bold');
    expect(result).toContain('italic');
    expect(result).toContain('console.log("hi");');
    expect(result).toContain('Link (https://example.com)');
  });

  it('should pass through plain text unchanged', () => {
    expect(stripMarkdown('Hello world')).toBe('Hello world');
  });
});
