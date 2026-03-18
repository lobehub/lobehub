import type { Root } from 'chat';
import { BaseFormatConverter, parseMarkdown, stringifyMarkdown } from 'chat';

export class QQFormatConverter extends BaseFormatConverter {
  /**
   * Convert mdast AST to QQ-compatible text.
   * QQ supports basic text messages, we convert markdown to plain text for now.
   */
  fromAst(ast: Root): string {
    return stringifyMarkdown(ast);
  }

  /**
   * Convert QQ message text to mdast AST.
   * Clean up QQ @mention markers before parsing.
   */
  toAst(text: string): Root {
    // Clean QQ @mention markers (e.g., <@!user_id>, <@user_id>)
    const cleaned = text
      .replaceAll(/<@!?\d+>/g, '')
      .replaceAll('<@everyone>', '')
      .replaceAll(/<#\d+>/g, '')
      .trim();

    return parseMarkdown(cleaned);
  }

  /**
   * Clean @mention markers from text
   */
  cleanMentions(text: string): string {
    return text
      .replaceAll(/<@!?\d+>/g, '')
      .replaceAll('<@everyone>', '')
      .replaceAll(/<#\d+>/g, '')
      .trim();
  }
}
