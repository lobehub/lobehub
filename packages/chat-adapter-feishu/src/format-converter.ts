import type { Root } from 'chat';
import { BaseFormatConverter, parseMarkdown, stringifyMarkdown } from 'chat';

/**
 * Format converter for Lark/Feishu.
 *
 * Lark text messages support basic markdown-like formatting.
 * We use plain markdown as the interchange format — no special escaping needed.
 */
export class LarkFormatConverter extends BaseFormatConverter {
  /**
   * Convert mdast AST to Lark-compatible text.
   * Lark displays markdown reasonably well, so we stringify directly.
   */
  fromAst(ast: Root): string {
    return stringifyMarkdown(ast);
  }

  /**
   * Convert Lark text to mdast AST.
   * Strip Lark @mention markers (@_user_N) before parsing.
   */
  toAst(text: string): Root {
    // Strip Lark @mention markers like @_user_1, @_all
    const cleaned = text
      .replaceAll(/@_user_\d+/g, '')
      .replaceAll('@_all', '')
      .trim();
    return parseMarkdown(cleaned);
  }
}
