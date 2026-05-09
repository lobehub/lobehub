import type { Root } from 'chat';
import { BaseFormatConverter, parseMarkdown, stringifyMarkdown } from 'chat';

/**
 * LINE's Messaging API renders text messages as **plain text** — no markdown,
 * no HTML, no rich blocks (rich content uses Flex Messages, which we don't
 * use here). The format converter therefore round-trips through
 * `stringifyMarkdown`, and the platform client further runs `stripMarkdown`
 * before sending so emphasis / heading / list markers are removed.
 */
export class LineFormatConverter extends BaseFormatConverter {
  fromAst(ast: Root): string {
    return stringifyMarkdown(ast);
  }

  toAst(text: string): Root {
    return parseMarkdown(text.trim());
  }
}
