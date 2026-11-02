import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';

import { CHANNEL_MENTION_TAG, remarkChannelMentions } from './mentionMarkdown';

const mentions = (markdown: string, names: string[]) => {
  const processor = unified().use(remarkParse).use(remarkChannelMentions(names));
  const tree = processor.runSync(processor.parse(markdown)) as any;
  const found: string[] = [];
  const walk = (node: any) => {
    if (node.data?.hName === CHANNEL_MENTION_TAG) found.push(node.children[0].value);
    node.children?.forEach(walk);
  };
  walk(tree);
  return found;
};

describe('remarkChannelMentions', () => {
  it('marks only the members the message mentioned', () => {
    expect(mentions('@锦妍 @Codex 请回复，@Pi 不用', ['锦妍', 'Codex'])).toEqual([
      '@锦妍',
      '@Codex',
    ]);
  });

  it('prefers the longer name and requires a boundary after it', () => {
    expect(mentions('@Pi Agent and @Pilot', ['Pi', 'Pi Agent'])).toEqual(['@Pi Agent']);
    expect(mentions('@Pilot', ['Pi'])).toEqual([]);
    expect(mentions('ask @Pi, then stop', ['Pi'])).toEqual(['@Pi']);
  });

  it('leaves code untouched', () => {
    expect(mentions('`@Pi` and\n\n```\n@Pi\n```', ['Pi'])).toEqual([]);
  });

  it('keeps the surrounding text', () => {
    const processor = unified()
      .use(remarkParse)
      .use(remarkChannelMentions(['Pi']));
    const tree = processor.runSync(processor.parse('hi @Pi there')) as any;
    expect(tree.children[0].children.map((node: any) => node.value ?? node.type)).toEqual([
      'hi ',
      'channelMention',
      ' there',
    ]);
  });
});
