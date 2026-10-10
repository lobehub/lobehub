// Fixture carve-out: an ordering comparison that shares the matcher but times nothing.
import { describe, expect, it } from 'vitest';

import { serializeDocument } from '../serialize';

describe('serializeDocument', () => {
  it('keeps paragraphs in source order', () => {
    const xml = serializeDocument([{ id: 'P1' }, { id: 'P2' }]);

    expect(xml.indexOf('P1')).toBeLessThan(xml.indexOf('P2'));
  });
});
