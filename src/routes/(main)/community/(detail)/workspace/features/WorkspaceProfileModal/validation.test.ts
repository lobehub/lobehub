import { describe, expect, it } from 'vitest';

import { getNamespaceError, isNamespaceFormatValid, isWebsiteUrlValid } from './validation';

describe('getNamespaceError', () => {
  it('accepts a namespace padded with whitespace', () => {
    expect(getNamespaceError(' acme-labs ')).toBeUndefined();
    expect(isNamespaceFormatValid(' acme-labs ')).toBe(true);
  });

  it('measures length after trimming', () => {
    expect(getNamespaceError('  ab  ')).toBe('length');
  });

  it('still rejects inner whitespace and invalid characters', () => {
    expect(getNamespaceError('acme labs')).toBe('pattern');
    expect(getNamespaceError('Acme')).toBe('pattern');
  });
});

describe('isWebsiteUrlValid', () => {
  it('accepts a URL padded with whitespace', () => {
    expect(isWebsiteUrlValid(' https://acme.dev ')).toBe(true);
  });

  it('rejects text that is not a URL', () => {
    expect(isWebsiteUrlValid('acme dev')).toBe(false);
  });
});
