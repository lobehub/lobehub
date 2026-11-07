import type { Root } from 'chat';
import { BaseFormatConverter, parseMarkdown, stringifyMarkdown } from 'chat';

/**
 * WeCom stream and markdown messages render common markdown natively, so outbound text stays
 * markdown. Inbound group text starts with the `@BotName` the user typed, which is stripped.
 */
export class WeComFormatConverter extends BaseFormatConverter {
  fromAst(ast: Root): string {
    return stringifyMarkdown(ast);
  }

  toAst(text: string): Root {
    return parseMarkdown(text);
  }

  /**
   * Drop the leading `@name` that addresses the bot in a group. WeCom only delivers group
   * messages that @-mention the bot and does not say which token is the bot, so only a leading
   * mention is removed; mentions of other people later in the text stay (未实测 against real
   * group payloads).
   */
  stripLeadingMention(text: string): string {
    return text.replace(/^\s*@\S+\s*/, '').trim();
  }
}
