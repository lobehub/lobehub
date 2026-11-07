import { describe, expect, it } from 'vitest';

import { serializeArtboardReference, serializeArtboardReferences } from './serialize';

const t = (key: string, options?: Record<string, unknown>) =>
  ({
    'artboard.chat.decided': `Decided: ${options?.text}`,
    'artboard.chat.quote': `Re: ${options?.target}`,
    'artboard.chat.stickyTarget': `Sticky “${options?.text}”`,
  })[key] ?? key;

describe('serializeArtboardReference', () => {
  it('quotes a frame comment with the board and frame it points at', () => {
    expect(
      serializeArtboardReference(
        {
          artboardId: 'art_1',
          itemId: 'f1',
          itemKind: 'frame',
          itemTitle: '空项目',
          kind: 'comment',
          text: '加一个返回按钮\n文案改短',
        },
        t,
      ),
    ).toBe('> Re: f1 · 空项目 · artboard art_1\n> 加一个返回按钮\n> 文案改短');
  });

  it('quotes a decision on a sticky question', () => {
    expect(
      serializeArtboardReference(
        {
          artboardId: 'art_1',
          itemId: 'n2',
          itemKind: 'note',
          itemTitle: '要保留吗？',
          kind: 'decision',
          text: '保留',
        },
        t,
      ),
    ).toBe('> Re: Sticky “要保留吗？” · artboard art_1\n> Decided: 保留');
  });

  it('separates several references so each stays its own quote', () => {
    const ref = {
      artboardId: 'art_1',
      itemId: 'f1',
      itemKind: 'frame' as const,
      itemTitle: 'A',
      kind: 'comment' as const,
      text: 'x',
    };
    expect(serializeArtboardReferences([ref, { ...ref, itemId: 'f2', itemTitle: 'B' }], t)).toBe(
      '> Re: f1 · A · artboard art_1\n> x\n\n> Re: f2 · B · artboard art_1\n> x',
    );
  });
});
