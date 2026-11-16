import { describe, expect, it } from 'vitest';

import { rejectModalHeading } from './rejectModalShell';

describe('rejectModalHeading', () => {
  it('splits the check code from its title', () => {
    expect(rejectModalHeading('C4 · Usage chart keeps the selected range')).toEqual({
      code: 'C4',
      title: 'Usage chart keeps the selected range',
    });
  });

  it('keeps a title without a check code whole', () => {
    expect(rejectModalHeading('Back on Usage')).toEqual({ title: 'Back on Usage' });
  });

  it('does not mistake a separator inside the title for a code', () => {
    expect(rejectModalHeading('Chart · legend overlaps')).toEqual({
      title: 'Chart · legend overlaps',
    });
    expect(rejectModalHeading('C12 · Chart · legend overlaps')).toEqual({
      code: 'C12',
      title: 'Chart · legend overlaps',
    });
  });
});
