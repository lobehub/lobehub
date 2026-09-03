import { describe, expect, it } from 'vitest';

import { loadPptxDraft, removePptxDraft, savePptxDraft } from './draftStorage';

describe('PPTX draft storage', () => {
  it('restores the exact saved bytes for the same source after reopening', async () => {
    const key = `pptx-draft-${crypto.randomUUID()}`;
    const sourceUrl = 'https://example.com/deck.pptx';
    const bytes = Uint8Array.from([80, 75, 3, 4, 84, 51, 50, 54]).buffer;

    await savePptxDraft(key, sourceUrl, bytes);
    const reopened = await loadPptxDraft(key, sourceUrl);

    expect(Array.from(new Uint8Array(reopened!.bytes))).toEqual(Array.from(new Uint8Array(bytes)));
    expect(reopened!.sourceUrl).toBe(sourceUrl);
    expect(reopened!.savedAt).toBeGreaterThan(0);

    await removePptxDraft(key);
    await expect(loadPptxDraft(key, sourceUrl)).resolves.toBeUndefined();
  });

  it('does not restore a draft against a different source revision', async () => {
    const key = `pptx-draft-${crypto.randomUUID()}`;
    await savePptxDraft(key, 'https://example.com/v1.pptx', new ArrayBuffer(2));

    await expect(loadPptxDraft(key, 'https://example.com/v2.pptx')).resolves.toBeUndefined();
    await removePptxDraft(key);
  });
});
