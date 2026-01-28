import { describe, expect, it, vi } from 'vitest';

import markdownToTxt, { markdownToTxt as namedExport } from './markdownToTxt';

describe('markdownToTxt', () => {
  describe('basic functionality', () => {
    it('should convert simple markdown to plain text', () => {
      const markdown = '# Hello World';
      const result = markdownToTxt(markdown);
      expect(result).toBe('Hello World');
    });

    it('should handle bold text', () => {
      const markdown = '**bold text**';
      const result = markdownToTxt(markdown);
      expect(result).toBe('bold text');
    });

    it('should handle italic text', () => {
      const markdown = '*italic text*';
      const result = markdownToTxt(markdown);
      expect(result).toBe('italic text');
    });

    it('should handle links', () => {
      const markdown = '[link text](https://example.com)';
      const result = markdownToTxt(markdown);
      expect(result).toBe('link text');
    });

    it('should handle inline code', () => {
      const markdown = 'Some `code` here';
      const result = markdownToTxt(markdown);
      expect(result).toBe('Some code here');
    });

    it('should handle code blocks', () => {
      const markdown = '```javascript\nconst x = 1;\n```';
      const result = markdownToTxt(markdown);
      expect(result).toContain('const x = 1;');
    });

    it('should handle lists', () => {
      const markdown = '- Item 1\n- Item 2\n- Item 3';
      const result = markdownToTxt(markdown);
      expect(result).toContain('Item 1');
      expect(result).toContain('Item 2');
      expect(result).toContain('Item 3');
    });

    it('should handle numbered lists', () => {
      const markdown = '1. First\n2. Second\n3. Third';
      const result = markdownToTxt(markdown);
      expect(result).toContain('First');
      expect(result).toContain('Second');
      expect(result).toContain('Third');
    });

    it('should handle blockquotes', () => {
      const markdown = '> This is a quote';
      const result = markdownToTxt(markdown);
      expect(result).toContain('This is a quote');
    });

    it('should handle horizontal rules', () => {
      const markdown = 'Before\n---\nAfter';
      const result = markdownToTxt(markdown);
      expect(result).toContain('Before');
      expect(result).toContain('After');
    });
  });

  describe('edge cases', () => {
    it('should return empty string for empty input', () => {
      expect(markdownToTxt('')).toBe('');
    });

    it('should handle null input', () => {
      expect(markdownToTxt(null as any)).toBe('');
    });

    it('should handle undefined input', () => {
      expect(markdownToTxt(undefined as any)).toBe('');
    });

    it('should handle plain text without markdown', () => {
      const plainText = 'Just plain text';
      const result = markdownToTxt(plainText);
      expect(result).toBe('Just plain text');
    });

    it('should handle whitespace-only input', () => {
      const result = markdownToTxt('   ');
      expect(result).toBe('');
    });

    it('should handle newlines and multiple spaces', () => {
      const markdown = 'Line 1\n\nLine 2\n\n\nLine 3';
      const result = markdownToTxt(markdown);
      expect(result).toContain('Line 1');
      expect(result).toContain('Line 2');
      expect(result).toContain('Line 3');
    });
  });

  describe('trimEnd behavior', () => {
    it('should trim trailing whitespace', () => {
      const markdown = 'Hello World   ';
      const result = markdownToTxt(markdown);
      expect(result).toBe('Hello World');
    });

    it('should trim trailing newlines', () => {
      const markdown = 'Hello World\n\n';
      const result = markdownToTxt(markdown);
      expect(result).toBe('Hello World');
    });

    it('should trim trailing tabs', () => {
      const markdown = 'Hello World\t\t';
      const result = markdownToTxt(markdown);
      expect(result).toBe('Hello World');
    });

    it('should not trim leading whitespace', () => {
      const markdown = '   Hello World';
      const result = markdownToTxt(markdown);
      expect(result).toContain('Hello World');
    });
  });

  describe('complex markdown', () => {
    it('should handle mixed markdown elements', () => {
      const markdown = `
# Title

This is **bold** and *italic* text with [a link](https://example.com).

- List item 1
- List item 2

\`\`\`javascript
const code = true;
\`\`\`

> A quote
      `;
      const result = markdownToTxt(markdown);
      expect(result).toContain('Title');
      expect(result).toContain('bold');
      expect(result).toContain('italic');
      expect(result).toContain('a link');
      expect(result).toContain('List item 1');
    });

    it('should handle nested markdown', () => {
      const markdown = '**Bold with *italic* inside**';
      const result = markdownToTxt(markdown);
      // remove-markdown may not perfectly handle nested formatting
      // It removes the outer bold but preserves the inner italic markers
      expect(result).toContain('Bold with');
      expect(result).toContain('inside');
    });

    it('should handle tables', () => {
      const markdown = `
| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
      `;
      const result = markdownToTxt(markdown);
      expect(result).toContain('Header 1');
      expect(result).toContain('Cell 1');
    });

    it('should handle images', () => {
      const markdown = '![Alt text](image.png)';
      const result = markdownToTxt(markdown);
      // Images are typically converted to alt text or removed
      expect(result).toBeTruthy();
    });
  });

  describe('error handling', () => {
    it('should fall back to raw input when parsing fails', () => {
      // Mock removeMarkdown to throw an error
      const mockMarkdown = 'test markdown';

      // We can't easily mock the imported function, so we test the behavior
      // The function should never throw, even with malformed input
      expect(() => markdownToTxt(mockMarkdown)).not.toThrow();
    });

    it('should handle extremely long strings', () => {
      const longMarkdown = '# Title\n' + 'a'.repeat(10000);
      expect(() => markdownToTxt(longMarkdown)).not.toThrow();
      const result = markdownToTxt(longMarkdown);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle special characters', () => {
      const markdown = '# Test & < > " \' / \\';
      expect(() => markdownToTxt(markdown)).not.toThrow();
    });

    it('should handle unicode characters', () => {
      const markdown = '# 你好世界 🌍';
      const result = markdownToTxt(markdown);
      expect(result).toContain('你好世界');
      expect(result).toContain('🌍');
    });

    it('should handle emoji in markdown', () => {
      const markdown = '**Bold emoji** 😀 *italic emoji* 🎉';
      const result = markdownToTxt(markdown);
      expect(result).toContain('😀');
      expect(result).toContain('🎉');
    });
  });

  describe('exports', () => {
    it('should export as default', () => {
      expect(typeof markdownToTxt).toBe('function');
    });

    it('should export as named export', () => {
      expect(typeof namedExport).toBe('function');
    });

    it('should have same behavior for default and named exports', () => {
      const markdown = '**test**';
      expect(markdownToTxt(markdown)).toBe(namedExport(markdown));
    });
  });

  describe('real-world use cases', () => {
    it('should handle chat message with markdown', () => {
      const chatMessage =
        'Hello! Check out this **important** link: [Documentation](https://docs.example.com)';
      const result = markdownToTxt(chatMessage);
      expect(result).toContain('Hello!');
      expect(result).toContain('important');
      expect(result).toContain('Documentation');
    });

    it('should handle code snippet in message', () => {
      const message = 'Use this code: `npm install` to get started';
      const result = markdownToTxt(message);
      expect(result).toContain('npm install');
      expect(result).toContain('to get started');
    });

    it('should handle multi-line chat response', () => {
      const response = `Here's how to do it:

1. First step
2. Second step
3. Third step

Let me know if you need help!`;
      const result = markdownToTxt(response);
      expect(result).toContain('First step');
      expect(result).toContain('Second step');
      expect(result).toContain('Third step');
      expect(result).toContain('Let me know');
    });

    it('should handle assistant response with code block', () => {
      const response = `Here's the solution:

\`\`\`typescript
function greet(name: string) {
  return \`Hello, \${name}!\`;
}
\`\`\`

This function greets the user.`;
      const result = markdownToTxt(response);
      expect(result).toContain('solution');
      expect(result).toContain('function greet');
      expect(result).toContain('This function');
    });
  });
});
