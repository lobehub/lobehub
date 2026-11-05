import type { AdapterPostableMessage, Root } from 'chat';
import { BaseFormatConverter, parseMarkdown, stringifyMarkdown } from 'chat';

import type { DingTalkOutboundMessage } from './types';

/** Markdown syntax DingTalk renders in `sampleMarkdown` (headings, emphasis, links, lists, quotes, code). */
const MARKDOWN_SYNTAX =
  /(^|\n)\s{0,3}(#{1,6}\s|>\s|[-*+]\s|\d+\.\s)|\*\*|__|`|!?\[[^\]]*]\([^)]+\)/;
const TITLE_MAX_LENGTH = 20;

export class DingTalkFormatConverter extends BaseFormatConverter {
  /** DingTalk renders markdown natively, so mdast is stringified back to markdown. */
  fromAst(ast: Root): string {
    return stringifyMarkdown(ast);
  }

  toAst(text: string): Root {
    return parseMarkdown(this.cleanText(text));
  }

  /**
   * Inbound group text arrives with the leading `@robot` mention already
   * removed by DingTalk but keeps the separating U+2005 (four-per-em space); normalise it.
   */
  cleanText(text: string): string {
    return text.replaceAll('\u2005', ' ').trim();
  }

  /**
   * Pick the robot message template for an outbound message: markdown when the
   * caller sent markdown/AST or the text contains markdown syntax, else plain text.
   */
  toOutboundMessage(message: AdapterPostableMessage, text: string): DingTalkOutboundMessage {
    const isStructured =
      typeof message === 'object' &&
      message !== null &&
      ('markdown' in message || 'ast' in message);

    if (isStructured || MARKDOWN_SYNTAX.test(text)) {
      return { msgKey: 'sampleMarkdown', msgParam: { text, title: this.deriveTitle(text) } };
    }
    return { msgKey: 'sampleText', msgParam: { content: text } };
  }

  /** The markdown title is what DingTalk shows in notifications and the chat list. */
  deriveTitle(markdown: string): string {
    const firstLine =
      markdown
        .split('\n')
        .map((line) =>
          line
            .replaceAll(/!?\[([^\]]*)]\([^)]*\)/g, '$1')
            .replaceAll(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/g, '')
            .replaceAll(/[*_`~]/g, '')
            .trim(),
        )
        .find(Boolean) ?? '';

    if (!firstLine) return 'Message';
    return firstLine.length > TITLE_MAX_LENGTH
      ? `${firstLine.slice(0, TITLE_MAX_LENGTH - 1)}…`
      : firstLine;
  }
}
