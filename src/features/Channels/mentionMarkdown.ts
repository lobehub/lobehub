import type { Plugin } from 'unified';
import { SKIP, visit } from 'unist-util-visit';

/** Element name the Markdown renderer maps to the Channel mention chip. */
export const CHANNEL_MENTION_TAG = 'channel-mention';

const escapeRegExp = (value: string) => value.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&');

/**
 * Marks `@Name` for the members a message actually mentioned, so the text reads like the chip
 * the author picked. Code stays literal; a longer name wins over a shorter prefix, and a name
 * must end at a space or punctuation (`@Pi` never highlights inside `@Pilot`).
 */
export const remarkChannelMentions =
  (names: string[]): Plugin<[], any> =>
  () => {
    const sorted = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
    if (!sorted.length) return;
    const pattern = new RegExp(
      `@(${sorted.map(escapeRegExp).join('|')})(?=$|[\\s\\p{P}\\p{S}])`,
      'gu',
    );
    return (tree: any) => {
      visit(tree, 'text', (node: any, index, parent: any) => {
        if (!parent || index === undefined) return;
        const value: string = node.value;
        const children: any[] = [];
        let last = 0;
        for (const match of value.matchAll(pattern)) {
          if (match.index > last)
            children.push({ type: 'text', value: value.slice(last, match.index) });
          children.push({
            children: [{ type: 'text', value: match[0] }],
            data: { hName: CHANNEL_MENTION_TAG, hProperties: { name: match[1] } },
            type: 'channelMention',
          });
          last = match.index + match[0].length;
        }
        if (!children.length) return;
        if (last < value.length) children.push({ type: 'text', value: value.slice(last) });
        parent.children.splice(index, 1, ...children);
        return [SKIP, index + children.length];
      });
    };
  };
