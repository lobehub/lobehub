import { describe, expect, it } from 'vitest';

import { applyDocumentDirection, getDocumentDirection } from './applyDocumentDirection';

describe('applyDocumentDirection', () => {
  it('returns rtl for Persian', () => {
    expect(getDocumentDirection('fa-IR')).toBe('rtl');
  });

  it('returns ltr for English', () => {
    expect(getDocumentDirection('en-US')).toBe('ltr');
  });

  it('sets document direction on the html element', () => {
    applyDocumentDirection('fa-IR');
    expect(document.documentElement.dir).toBe('rtl');

    applyDocumentDirection('en-US');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('resolves auto locale from document lang for direction', () => {
    document.documentElement.lang = 'fa-IR';

    applyDocumentDirection('auto');
    expect(document.documentElement.dir).toBe('rtl');

    document.documentElement.lang = 'en-US';
    applyDocumentDirection('auto');
    expect(document.documentElement.dir).toBe('ltr');
  });
});
