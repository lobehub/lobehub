import type { Root } from 'chat';
import { BaseFormatConverter, parseMarkdown, stringifyMarkdown } from 'chat';

/**
 * iMessage ultimately receives plain text through BlueBubbles. Keeping the
 * markdown markers here preserves Chat SDK compatibility; the LobeHub platform
 * client strips markdown before final bot replies are sent.
 */
export class ImessageFormatConverter extends BaseFormatConverter {
  fromAst(ast: Root): string {
    return stringifyMarkdown(ast);
  }

  toAst(text: string): Root {
    return parseMarkdown(text.trim());
  }
}
