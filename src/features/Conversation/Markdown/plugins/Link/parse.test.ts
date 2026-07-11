import { describe, expect, it } from 'vitest';

import { parseLobeLink } from './parse';

describe('parseLobeLink', () => {
  it('parses github pull request', () => {
    expect(parseLobeLink('https://github.com/lobehub/lobehub/pull/15557')).toEqual({
      canonicalLabel: 'lobehub/lobehub#15557',
      kind: 'github',
    });
  });

  it('parses github issue', () => {
    expect(parseLobeLink('https://github.com/lobehub/lobehub/issues/15554')).toEqual({
      canonicalLabel: 'lobehub/lobehub#15554',
      kind: 'github',
    });
  });

  it('parses github commit (short sha)', () => {
    expect(parseLobeLink('https://github.com/lobehub/lobehub/commit/d36aa75701abc')).toEqual({
      canonicalLabel: 'lobehub/lobehub@d36aa75',
      kind: 'github',
    });
  });

  it('parses github repo root', () => {
    expect(parseLobeLink('https://github.com/lobehub/lobehub')).toEqual({
      canonicalLabel: 'lobehub/lobehub',
      kind: 'github',
    });
  });

  it('parses linear issue', () => {
    expect(parseLobeLink('https://linear.app/lobehub/issue/TST-10001/codex-pptx-preview')).toEqual({
      canonicalLabel: 'TST-10001',
      kind: 'linear',
    });
  });

  it('parses github user / org pages with the github icon', () => {
    expect(parseLobeLink('https://github.com/lobehub')).toEqual({
      canonicalLabel: 'lobehub',
      kind: 'github',
    });
  });

  it('uses the full URL as label for generic http links', () => {
    expect(parseLobeLink('https://example.com/foo')).toEqual({
      canonicalLabel: 'https://example.com/foo',
      domain: 'example.com',
      kind: 'generic',
    });
    // bare github.com (no owner) → generic
    expect(parseLobeLink('https://github.com')?.kind).toBe('generic');
  });

  it('labels npm packages by package name', () => {
    expect(parseLobeLink('https://www.npmjs.com/package/@lobehub/ui')).toEqual({
      canonicalLabel: '@lobehub/ui',
      domain: 'npmjs.com',
      kind: 'generic',
    });
    expect(parseLobeLink('https://www.npmjs.com/package/react/v/18.0.0')?.canonicalLabel).toBe(
      'react',
    );
  });

  it('labels figma links by file name', () => {
    expect(parseLobeLink('https://www.figma.com/file/abc123/Design-File')?.canonicalLabel).toBe(
      'Design File',
    );
    expect(parseLobeLink('https://www.figma.com/design/abc123/My-Board')?.canonicalLabel).toBe(
      'My Board',
    );
  });

  it('parses mailto links as email', () => {
    expect(parseLobeLink('mailto:hi@example.com')).toEqual({
      canonicalLabel: 'hi@example.com',
      kind: 'email',
    });
    expect(parseLobeLink('mailto:hi@example.com?subject=Hello')?.canonicalLabel).toBe(
      'hi@example.com',
    );
  });

  it('keeps root-relative links for the internal-link renderer', () => {
    expect(parseLobeLink('/foo/bar')).toEqual({
      canonicalLabel: '/foo/bar',
      kind: 'generic',
    });
  });

  it('ignores citation, footnote and non-http hrefs', () => {
    expect(parseLobeLink('citation-1')).toBeNull();
    expect(parseLobeLink('#user-content-fn-1')).toBeNull();
    expect(parseLobeLink(undefined)).toBeNull();
  });
});
