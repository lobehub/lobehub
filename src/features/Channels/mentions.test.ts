import { $createParagraphNode, $createTextNode, $getRoot, createEditor } from 'lexical';
import { describe, expect, it } from 'vitest';

import { $insertChannelMentionBoundary, channelMentionIds } from './mentions';

describe('Channel mention boundaries', () => {
  const insert = (
    text: string,
    options: { code?: boolean; event?: KeyboardEventInit; range?: [number, number] } = {},
  ) => {
    const editor = createEditor({
      onError: (error) => {
        throw error;
      },
    });
    let handled = false;
    let result = '';
    editor.update(
      () => {
        const node = $createTextNode(text);
        if (options.code) node.setFormat('code');
        $getRoot().append($createParagraphNode().append(node));
        const [start, end] = options.range ?? [text.length, text.length];
        node.select(start, end);
        handled = $insertChannelMentionBoundary(
          new KeyboardEvent('keydown', { key: '@', ...options.event }),
        );
        result = node.getTextContent();
      },
      { discrete: true },
    );
    return { handled, result };
  };

  it('inserts at the caret after Chinese prose and punctuation, preserving following text', () => {
    expect(insert('请分析后续', { range: [3, 3] })).toEqual({
      handled: true,
      result: '请分析 @后续',
    });
    expect(insert('整理需求；')).toEqual({ handled: true, result: '整理需求； @' });
  });

  it.each(['email.name', 'hello', '已经有空格 ', ''])(
    'leaves ordinary input %j to the editor',
    (text) => {
      expect(insert(text)).toEqual({ handled: false, result: text });
    },
  );

  it('does not alter code, composing input, other keys, or a non-collapsed selection', () => {
    for (const options of [
      { code: true },
      { event: { isComposing: true } },
      { event: { key: 'Enter' } },
      { range: [0, 1] as [number, number] },
    ])
      expect(insert('说明', options)).toEqual({ handled: false, result: '说明' });
  });
});

const chip = (id: string) => ({ type: 'mention', metadata: { type: 'channel-member', id } });
describe('Channel recipient chips', () => {
  it('selects only real active member chips, not text, code, foreign IDs or another mention kind', () => {
    expect(
      channelMentionIds(
        {
          root: {
            children: [
              { type: 'text', text: '@B @all' },
              chip('A'),
              chip('A'),
              chip('foreign'),
              { type: 'code', children: [chip('B')] },
              { type: 'mention', metadata: { type: 'agent', id: 'B' } },
            ],
          },
        },
        ['A', 'B'],
      ),
    ).toEqual(['A']);
  });
  it('reflects chip removal rather than retaining a previous recipient', () => {
    expect(
      channelMentionIds({ root: { children: [chip('B'), chip('A'), chip('B')] } }, ['A', 'B']),
    ).toEqual(['B', 'A']);
    expect(channelMentionIds({ root: { children: [chip('A')] } }, ['A', 'B'])).toEqual(['A']);
    expect(channelMentionIds({ root: { children: [] } }, ['A', 'B'])).toEqual([]);
  });
});
