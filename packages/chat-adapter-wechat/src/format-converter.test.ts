import { parseMarkdown } from 'chat';
import { describe, expect, it } from 'vitest';

import { WechatFormatConverter } from './format-converter';

describe('WechatFormatConverter', () => {
  const converter = new WechatFormatConverter();

  describe('toAst', () => {
    it('should convert plain text to AST', () => {
      const ast = converter.toAst('hello world');
      expect(ast.type).toBe('root');
      expect(ast.children.length).toBeGreaterThan(0);
    });

    it('should trim whitespace before parsing', () => {
      const ast = converter.toAst('  hello  ');
      const text = converter.fromAst(ast);
      expect(text.trim()).toBe('hello');
    });
  });

  describe('fromAst', () => {
    it('should convert AST back to text', () => {
      const ast = parseMarkdown('hello world');
      const text = converter.fromAst(ast);
      expect(text.trim()).toBe('hello world');
    });

    it('should handle markdown formatting', () => {
      const ast = parseMarkdown('**bold** and *italic*');
      const text = converter.fromAst(ast);
      expect(text).toContain('bold');
      expect(text).toContain('italic');
    });
  });

  describe('round-trip', () => {
    it('should preserve plain text through round-trip', () => {
      const original = 'simple text message';
      const ast = converter.toAst(original);
      const result = converter.fromAst(ast);
      expect(result.trim()).toBe(original);
    });
  });
});
