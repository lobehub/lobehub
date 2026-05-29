import type { Root } from 'chat';
import { BaseFormatConverter, parseMarkdown, toPlainText } from 'chat';

/**
 * WhatsApp (via Wati) only accepts plain session text — no markdown parse mode.
 */
export class WatiFormatConverter extends BaseFormatConverter {
  fromAst(ast: Root): string {
    return toPlainText(ast);
  }

  toAst(text: string): Root {
    return parseMarkdown(text.trim());
  }
}
