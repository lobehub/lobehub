import { describe, expect, it } from 'vitest';

import { serializeArtboardReference, serializeArtboardReferences } from './serialize';

const t = (key: string, options?: Record<string, unknown>) =>
  ({ 'artboard.chat.quote': `Re: ${options?.target}` })[key] ?? key;

const ref = { artboardId: 'art_1', itemId: 'b1', itemTitle: 'A', text: 'x' };

describe('serializeArtboardReference', () => {
  it('quotes a comment with the artboard and the board it points at', () => {
    expect(
      serializeArtboardReference(
        { ...ref, itemTitle: '空项目', text: '加一个返回按钮\n文案改短' },
        t,
      ),
    ).toBe('> Re: b1 · 空项目 · artboard art_1\n> 加一个返回按钮\n> 文案改短');
  });

  it('separates several references so each stays its own quote', () => {
    expect(serializeArtboardReferences([ref, { ...ref, itemId: 'b2', itemTitle: 'B' }], t)).toBe(
      '> Re: b1 · A · artboard art_1\n> x\n\n> Re: b2 · B · artboard art_1\n> x',
    );
  });
});
