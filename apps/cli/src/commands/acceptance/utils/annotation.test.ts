import { describe, expect, it } from 'vitest';

import { formatAnnotationRegion, formatDisputedChapter } from '.';

describe('formatAnnotationRegion', () => {
  const rect = { height: 0.03, width: 0.12, x: 0.31, y: 0.24 };

  it('names the evidence the region was drawn on and where on it', () => {
    expect(
      formatAnnotationRegion(
        { comment: 'too light', evidenceId: 'ev-1', rect },
        new Map([['ev-1', 'c11-profile-editing.png']]),
      ),
    ).toBe('c11-profile-editing.png @ 31%,24% · 12%×3%');
  });

  // Without the filename a reader still cannot tell WHICH screenshot was circled,
  // so the raw id is better than dropping the reference entirely.
  it('falls back to the raw evidence id when the label is unknown', () => {
    expect(formatAnnotationRegion({ evidenceId: 'ev-9', rect })).toBe('ev-9 @ 31%,24% · 12%×3%');
  });

  it('renders the position alone when the annotation names no evidence', () => {
    expect(formatAnnotationRegion({ rect })).toBe('31%,24% · 12%×3%');
  });

  it('renders the evidence alone when the rect is absent', () => {
    expect(formatAnnotationRegion({ evidenceId: 'ev-1' }, new Map([['ev-1', 'shot.png']]))).toBe(
      'shot.png',
    );
  });

  // Reviews made before regions existed carry only a comment — printing an empty
  // "└" line under every one of them would be pure noise.
  it('returns undefined when there is no location at all', () => {
    expect(formatAnnotationRegion({ comment: 'just a note' })).toBeUndefined();
    expect(formatAnnotationRegion({ rect: { x: 0.1 } })).toBeUndefined();
  });
  it('leads with the frame on a video, then the region circled on it', () => {
    expect(
      formatAnnotationRegion(
        { evidenceId: 'ev-1', rect, time: { start: 7.2 } },
        new Map([['ev-1', 'scroll.mp4']]),
      ),
    ).toBe('scroll.mp4 @ frame at 0:07.20 · 31%,24% · 12%×3%');
  });

  it('prints a span, and no region at all when the note covers the whole frame', () => {
    expect(
      formatAnnotationRegion({
        evidenceId: 'ev-1',
        rect: { height: 1, width: 1, x: 0, y: 0 },
        time: { end: 67.65, start: 66.75 },
      }),
    ).toBe('ev-1 @ 1:06.75–1:07.65');
  });
});

describe('formatDisputedChapter', () => {
  it('quotes the agent claim the reviewer objected to', () => {
    expect(
      formatDisputedChapter({ kind: 'check', note: 'no skeleton after scroll #3', t: 7.9 }),
    ).toBe('your check at 0:07.90: "no skeleton after scroll #3"');
  });

  it('says nothing when there is no claim to quote', () => {
    expect(formatDisputedChapter(undefined)).toBeUndefined();
    expect(formatDisputedChapter({ kind: 'check', t: 1 })).toBeUndefined();
  });
});
