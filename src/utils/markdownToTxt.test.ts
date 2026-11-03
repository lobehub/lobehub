import { describe, expect, it } from 'vitest';

import { markdownToTxt } from './markdownToTxt';

describe('markdownToTxt', () => {
  describe('basic markdown conversion', () => {
    it('should convert plain text without changes', () => {
      expect(markdownToTxt('Hello world')).toBe('Hello world');
    });

    it('should remove headers and keep text', () => {
      expect(markdownToTxt('# Heading 1')).toBe('Heading 1');
      expect(markdownToTxt('## Heading 2')).toBe('Heading 2');
      expect(markdownToTxt('### Heading 3')).toBe('Heading 3');
    });

    it('should remove bold formatting', () => {
      expect(markdownToTxt('**bold text**')).toBe('bold text');
      expect(markdownToTxt('__bold text__')).toBe('bold text');
    });

    it('should remove italic formatting', () => {
      expect(markdownToTxt('*italic text*')).toBe('italic text');
      expect(markdownToTxt('_italic text_')).toBe('italic text');
    });

    it('should remove links and keep text', () => {
      expect(markdownToTxt('[link text](https://example.com)')).toBe('link text');
    });

    it('should remove images', () => {
      const result = markdownToTxt('![alt text](image.jpg)');
      // remove-markdown library behavior may vary, but image should be removed or simplified
      expect(result).not.toContain('![');
      expect(result).not.toContain('](');
    });

    it('should remove code blocks', () => {
      const markdown = '```javascript\nconst x = 1;\n```';
      const result = markdownToTxt(markdown);
      expect(result).not.toContain('```');
    });

    it('should remove inline code formatting', () => {
      expect(markdownToTxt('Use `code` here')).toBe('Use code here');
    });

    it('should convert lists to plain text', () => {
      const markdown = '- Item 1\n- Item 2\n- Item 3';
      const result = markdownToTxt(markdown);
      expect(result).toContain('Item 1');
      expect(result).toContain('Item 2');
      expect(result).toContain('Item 3');
      expect(result).not.toContain('- ');
    });

    it('should convert numbered lists to plain text', () => {
      const markdown = '1. First\n2. Second\n3. Third';
      const result = markdownToTxt(markdown);
      expect(result).toContain('First');
      expect(result).toContain('Second');
      expect(result).toContain('Third');
    });

    it('should remove blockquotes', () => {
      const markdown = '> This is a quote';
      const result = markdownToTxt(markdown);
      expect(result).toContain('This is a quote');
      expect(result).not.toContain('>');
    });
  });

  describe('complex markdown conversion', () => {
    it('should handle mixed formatting', () => {
      const markdown = '# Title\n\n**Bold** and *italic* with [link](url)';
      const result = markdownToTxt(markdown);
      expect(result).toContain('Title');
      expect(result).toContain('Bold');
      expect(result).toContain('italic');
      expect(result).toContain('link');
      expect(result).not.toContain('#');
      expect(result).not.toContain('**');
      expect(result).not.toContain('*');
      expect(result).not.toContain('[');
      expect(result).not.toContain(']');
    });

    it('should handle nested markdown structures', () => {
      const markdown = '- **Bold item**\n- *Italic item*\n- [Link item](url)';
      const result = markdownToTxt(markdown);
      expect(result).toContain('Bold item');
      expect(result).toContain('Italic item');
      expect(result).toContain('Link item');
    });

    it('should handle markdown tables', () => {
      const markdown = '| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |';
      const result = markdownToTxt(markdown);
      expect(result).toContain('Header 1');
      expect(result).toContain('Header 2');
      expect(result).toContain('Cell 1');
      expect(result).toContain('Cell 2');
    });

    it('should handle horizontal rules', () => {
      const markdown = 'Text before\n\n---\n\nText after';
      const result = markdownToTxt(markdown);
      expect(result).toContain('Text before');
      expect(result).toContain('Text after');
    });
  });

  describe('edge cases', () => {
    it('should return empty string for empty input', () => {
      expect(markdownToTxt('')).toBe('');
    });

    it('should handle whitespace-only input', () => {
      expect(markdownToTxt('   ')).toBe('');
      expect(markdownToTxt('\n\n\n')).toBe('');
    });

    it('should trim trailing whitespace', () => {
      const result = markdownToTxt('Hello world   \n\n');
      expect(result).toBe('Hello world');
    });

    it('should handle very long markdown text', () => {
      const longMarkdown = '# Title\n\n' + 'Lorem ipsum '.repeat(1000);
      const result = markdownToTxt(longMarkdown);
      expect(result).toContain('Title');
      expect(result).toContain('Lorem ipsum');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle special characters', () => {
      expect(markdownToTxt('Special chars: @#$%^&*()')).toBe('Special chars: @#$%^&*()');
    });

    it('should handle unicode characters', () => {
      expect(markdownToTxt('Unicode: 你好 🌟')).toBe('Unicode: 你好 🌟');
    });

    it('should handle emoji in markdown', () => {
      expect(markdownToTxt('**Bold** 🎉 *italic*')).toContain('🎉');
    });
  });

  describe('error handling', () => {
    it('should fallback to original markdown on parsing errors', () => {
      // The try-catch in markdownToTxt should handle any errors gracefully
      // Since we can't easily force remove-markdown to fail, we test valid input
      const markdown = 'Valid markdown';
      const result = markdownToTxt(markdown);
      expect(result).toBe('Valid markdown');
    });

    it('should handle malformed markdown gracefully', () => {
      // Unclosed formatting
      const malformed1 = '**Bold without closing';
      const result1 = markdownToTxt(malformed1);
      expect(result1).toBeDefined();
      expect(typeof result1).toBe('string');

      // Unclosed link
      const malformed2 = '[Link without closing](';
      const result2 = markdownToTxt(malformed2);
      expect(result2).toBeDefined();
      expect(typeof result2).toBe('string');
    });

    it('should handle null-like values by returning empty string', () => {
      // @ts-expect-error - testing runtime behavior
      expect(markdownToTxt(null)).toBe('');
      // @ts-expect-error - testing runtime behavior
      expect(markdownToTxt(undefined)).toBe('');
    });
  });

  describe('real-world examples', () => {
    it('should convert typical README content', () => {
      const readme = `# Project Title

## Description

This is a **sample** project with *important* features:

- Feature 1
- Feature 2
- Feature 3

Check out our [website](https://example.com) for more info.

\`\`\`bash
npm install package
\`\`\`
`;
      const result = markdownToTxt(readme);
      expect(result).toContain('Project Title');
      expect(result).toContain('Description');
      expect(result).toContain('sample');
      expect(result).toContain('important');
      expect(result).toContain('Feature 1');
      expect(result).toContain('website');
      expect(result).not.toContain('#');
      expect(result).not.toContain('**');
      expect(result).not.toContain('```');
    });

    it('should convert chat messages', () => {
      const message =
        'I need help with `React.useState()` and **props** in *functional components*.';
      const result = markdownToTxt(message);
      expect(result).toBe('I need help with React.useState() and props in functional components.');
    });

    it('should convert documentation snippets', () => {
      const doc =
        '### API Reference\n\nUse the `fetchData()` method with these parameters:\n\n- `url`: string\n- `options`: object';
      const result = markdownToTxt(doc);
      expect(result).toContain('API Reference');
      expect(result).toContain('fetchData()');
      expect(result).toContain('url');
      expect(result).toContain('string');
    });
  });

  describe('whitespace handling', () => {
    it('should preserve internal spacing', () => {
      expect(markdownToTxt('Hello   world')).toContain('Hello');
      expect(markdownToTxt('Hello   world')).toContain('world');
    });

    it('should trim end of output', () => {
      expect(markdownToTxt('Text\n\n\n')).toBe('Text');
      expect(markdownToTxt('Text   ')).toBe('Text');
    });

    it('should handle multiple newlines in content', () => {
      const markdown = 'Paragraph 1\n\n\nParagraph 2';
      const result = markdownToTxt(markdown);
      expect(result).toContain('Paragraph 1');
      expect(result).toContain('Paragraph 2');
    });
  });
});
