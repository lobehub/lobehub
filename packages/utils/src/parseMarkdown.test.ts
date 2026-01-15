import { describe, expect, it } from 'vitest';

import { parseMarkdown } from './parseMarkdown';

describe('parseMarkdown', () => {
  describe('basic markdown parsing', () => {
    it('should parse simple text', async () => {
      const input = 'Hello, World!';
      const result = await parseMarkdown(input);

      expect(result).toContain('Hello, World!');
      expect(result).toMatch(/<p>Hello, World!<\/p>/);
    });

    it('should parse headings', async () => {
      const input = '# Heading 1\n## Heading 2\n### Heading 3';
      const result = await parseMarkdown(input);

      expect(result).toContain('<h1>Heading 1</h1>');
      expect(result).toContain('<h2>Heading 2</h2>');
      expect(result).toContain('<h3>Heading 3</h3>');
    });

    it('should parse bold text', async () => {
      const input = 'This is **bold** text';
      const result = await parseMarkdown(input);

      expect(result).toContain('<strong>bold</strong>');
    });

    it('should parse italic text', async () => {
      const input = 'This is *italic* text';
      const result = await parseMarkdown(input);

      expect(result).toContain('<em>italic</em>');
    });

    it('should parse links', async () => {
      const input = '[Google](https://google.com)';
      const result = await parseMarkdown(input);

      expect(result).toContain('<a href="https://google.com">Google</a>');
    });

    it('should parse code blocks', async () => {
      const input = '```javascript\nconst x = 1;\n```';
      const result = await parseMarkdown(input);

      expect(result).toContain('<code');
      expect(result).toContain('const x = 1;');
    });

    it('should parse inline code', async () => {
      const input = 'Use `const` for constants';
      const result = await parseMarkdown(input);

      expect(result).toContain('<code>const</code>');
    });

    it('should parse unordered lists', async () => {
      const input = '- Item 1\n- Item 2\n- Item 3';
      const result = await parseMarkdown(input);

      expect(result).toContain('<ul>');
      expect(result).toContain('<li>Item 1</li>');
      expect(result).toContain('<li>Item 2</li>');
      expect(result).toContain('<li>Item 3</li>');
      expect(result).toContain('</ul>');
    });

    it('should parse ordered lists', async () => {
      const input = '1. First\n2. Second\n3. Third';
      const result = await parseMarkdown(input);

      expect(result).toContain('<ol>');
      expect(result).toContain('<li>First</li>');
      expect(result).toContain('<li>Second</li>');
      expect(result).toContain('<li>Third</li>');
      expect(result).toContain('</ol>');
    });

    it('should parse blockquotes', async () => {
      const input = '> This is a quote';
      const result = await parseMarkdown(input);

      expect(result).toContain('<blockquote>');
      expect(result).toContain('This is a quote');
      expect(result).toContain('</blockquote>');
    });

    it('should parse horizontal rules', async () => {
      const input = '---';
      const result = await parseMarkdown(input);

      expect(result).toContain('<hr>');
    });
  });

  describe('GitHub Flavored Markdown (GFM) support', () => {
    it('should parse strikethrough text', async () => {
      const input = '~~strikethrough~~';
      const result = await parseMarkdown(input);

      expect(result).toContain('<del>strikethrough</del>');
    });

    it('should parse tables', async () => {
      const input = `| Header 1 | Header 2 |
| --- | --- |
| Cell 1 | Cell 2 |`;
      const result = await parseMarkdown(input);

      expect(result).toContain('<table>');
      expect(result).toContain('<thead>');
      expect(result).toContain('<th>Header 1</th>');
      expect(result).toContain('<th>Header 2</th>');
      expect(result).toContain('<tbody>');
      expect(result).toContain('<td>Cell 1</td>');
      expect(result).toContain('<td>Cell 2</td>');
    });

    it('should parse task lists', async () => {
      const input = '- [x] Completed task\n- [ ] Incomplete task';
      const result = await parseMarkdown(input);

      expect(result).toContain('type="checkbox"');
      expect(result).toContain('checked');
      expect(result).toContain('disabled');
    });

    it('should parse autolinks', async () => {
      const input = 'Visit https://example.com for more info';
      const result = await parseMarkdown(input);

      expect(result).toContain('<a href="https://example.com">https://example.com</a>');
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', async () => {
      const input = '';
      const result = await parseMarkdown(input);

      expect(result).toBe('');
    });

    it('should trim whitespace', async () => {
      const input = '   \n\n  Hello  \n\n  ';
      const result = await parseMarkdown(input);

      expect(result).toContain('Hello');
      expect(result).not.toMatch(/^\s+/);
    });

    it('should handle special HTML characters', async () => {
      const input = 'Use & symbols';
      const result = await parseMarkdown(input);

      // HTML special characters should be escaped
      expect(result).toContain('&#x26;');
      // The result should contain the escaped character but <brackets> are interpreted as HTML
    });

    it('should handle nested formatting', async () => {
      const input = '**Bold with *italic* inside**';
      const result = await parseMarkdown(input);

      expect(result).toContain('<strong>');
      expect(result).toContain('<em>italic</em>');
      expect(result).toContain('</strong>');
    });

    it('should handle multiline content', async () => {
      const input = `# Title

This is a paragraph.

This is another paragraph.`;
      const result = await parseMarkdown(input);

      expect(result).toContain('<h1>Title</h1>');
      expect(result).toContain('This is a paragraph.');
      expect(result).toContain('This is another paragraph.');
    });
  });

  describe('complex markdown structures', () => {
    it('should parse nested lists', async () => {
      const input = `- Parent 1
  - Child 1
  - Child 2
- Parent 2`;
      const result = await parseMarkdown(input);

      expect(result).toContain('<ul>');
      expect(result).toContain('Parent 1');
      expect(result).toContain('Child 1');
      expect(result).toContain('Child 2');
      expect(result).toContain('Parent 2');
    });

    it('should parse mixed content', async () => {
      const input = `# Introduction

This is a **bold** statement with a [link](https://example.com).

\`\`\`javascript
const example = true;
\`\`\`

## Features

- Feature 1
- Feature 2

> Important note here`;

      const result = await parseMarkdown(input);

      expect(result).toContain('<h1>Introduction</h1>');
      expect(result).toContain('<strong>bold</strong>');
      expect(result).toContain('<a href="https://example.com">link</a>');
      expect(result).toContain('const example = true;');
      expect(result).toContain('<h2>Features</h2>');
      expect(result).toContain('<li>Feature 1</li>');
      expect(result).toContain('<blockquote>');
    });

    it('should handle code blocks with language specification', async () => {
      const input = '```typescript\ntype User = { name: string };\n```';
      const result = await parseMarkdown(input);

      expect(result).toContain('type User = { name: string };');
      expect(result).toContain('<code');
    });

    it('should parse lists with multiple paragraphs', async () => {
      const input = `- Item 1

  Additional paragraph

- Item 2`;
      const result = await parseMarkdown(input);

      expect(result).toContain('Item 1');
      expect(result).toContain('Additional paragraph');
      expect(result).toContain('Item 2');
    });
  });

  describe('return type', () => {
    it('should return a string', async () => {
      const input = 'Test';
      const result = await parseMarkdown(input);

      expect(typeof result).toBe('string');
    });

    it('should always return HTML string', async () => {
      const inputs = ['Plain text', '# Heading', '**Bold**', '[Link](url)', '```code```', '- List'];

      for (const input of inputs) {
        const result = await parseMarkdown(input);
        expect(typeof result).toBe('string');
        // Should contain HTML tags
        expect(result).toMatch(/<[^>]+>/);
      }
    });
  });
});
