import { describe, expect, it } from 'vitest';

import { normalizeSiteOrigin, siteOriginMatches } from './siteOrigin';

describe('normalizeSiteOrigin', () => {
  it('accepts an exact https origin and normalizes case and default port', () => {
    expect(normalizeSiteOrigin('HTTPS://Fieldnotes.App:443')).toEqual({
      ok: true,
      origin: 'https://fieldnotes.app',
    });
  });

  it('keeps a non-default port', () => {
    expect(normalizeSiteOrigin('https://preview.fieldnotes.app:8443')).toEqual({
      ok: true,
      origin: 'https://preview.fieldnotes.app:8443',
    });
  });

  it('rejects a port outside the URL range and canonicalizes leading zeros', () => {
    expect(normalizeSiteOrigin('https://fieldnotes.app:99999')).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(normalizeSiteOrigin('https://fieldnotes.app:65535')).toEqual({
      ok: true,
      origin: 'https://fieldnotes.app:65535',
    });
    expect(normalizeSiteOrigin('https://fieldnotes.app:00443')).toEqual({
      ok: true,
      origin: 'https://fieldnotes.app',
    });
  });

  it('allows plain http only for loopback hosts', () => {
    expect(normalizeSiteOrigin('http://localhost:3000')).toEqual({
      ok: true,
      origin: 'http://localhost:3000',
    });
    expect(normalizeSiteOrigin('http://127.0.0.1:5173')).toEqual({
      ok: true,
      origin: 'http://127.0.0.1:5173',
    });
    expect(normalizeSiteOrigin('http://192.168.1.5:3000')).toEqual({
      ok: false,
      reason: 'insecure',
    });
  });

  it('rejects paths, queries and credentials', () => {
    expect(normalizeSiteOrigin('https://fieldnotes.app/blog')).toEqual({
      ok: false,
      reason: 'path',
    });
    expect(normalizeSiteOrigin('https://fieldnotes.app/?a=1')).toEqual({
      ok: false,
      reason: 'path',
    });
    expect(normalizeSiteOrigin('https://user:pw@fieldnotes.app')).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('accepts a trailing slash as the bare origin', () => {
    expect(normalizeSiteOrigin('https://fieldnotes.app/')).toEqual({
      ok: true,
      origin: 'https://fieldnotes.app',
    });
  });

  it('accepts a one-level wildcard on a registrable domain', () => {
    expect(normalizeSiteOrigin('https://*.Fieldnotes.app')).toEqual({
      ok: true,
      origin: 'https://*.fieldnotes.app',
    });
    expect(normalizeSiteOrigin('https://*.preview.fieldnotes.app')).toEqual({
      ok: true,
      origin: 'https://*.preview.fieldnotes.app',
    });
  });

  it('rejects a wildcard on a public suffix or shared host', () => {
    for (const input of [
      'https://*.vercel.app',
      'https://*.netlify.app',
      'https://*.github.io',
      'https://*.pages.dev',
      'https://*.com',
      'https://*.co.uk',
    ]) {
      expect(normalizeSiteOrigin(input), input).toEqual({
        ok: false,
        reason: 'sharedHostWildcard',
      });
    }
  });

  it('rejects wildcards anywhere but the first label', () => {
    expect(normalizeSiteOrigin('https://app.*.fieldnotes.app')).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(normalizeSiteOrigin('https://*')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects garbage', () => {
    expect(normalizeSiteOrigin('fieldnotes.app')).toEqual({ ok: false, reason: 'invalid' });
    expect(normalizeSiteOrigin('ftp://fieldnotes.app')).toEqual({ ok: false, reason: 'invalid' });
    expect(normalizeSiteOrigin('')).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('siteOriginMatches', () => {
  it('matches an exact origin only', () => {
    expect(siteOriginMatches('https://fieldnotes.app', 'https://fieldnotes.app')).toBe(true);
    expect(siteOriginMatches('https://fieldnotes.app', 'https://www.fieldnotes.app')).toBe(false);
    expect(siteOriginMatches('https://fieldnotes.app', 'http://fieldnotes.app')).toBe(false);
    expect(siteOriginMatches('https://fieldnotes.app', 'https://fieldnotes.app:8443')).toBe(false);
  });

  it('matches exactly one subdomain level for a wildcard', () => {
    expect(siteOriginMatches('https://*.fieldnotes.app', 'https://pr-12.fieldnotes.app')).toBe(
      true,
    );
    expect(siteOriginMatches('https://*.fieldnotes.app', 'https://fieldnotes.app')).toBe(false);
    expect(siteOriginMatches('https://*.fieldnotes.app', 'https://a.b.fieldnotes.app')).toBe(false);
    expect(siteOriginMatches('https://*.fieldnotes.app', 'https://evilfieldnotes.app')).toBe(false);
  });

  it('normalizes the request origin before comparing', () => {
    expect(siteOriginMatches('https://fieldnotes.app', 'HTTPS://FIELDNOTES.APP:443')).toBe(true);
  });

  it('never matches an opaque or malformed origin', () => {
    expect(siteOriginMatches('https://fieldnotes.app', 'null')).toBe(false);
    expect(siteOriginMatches('https://*.fieldnotes.app', '')).toBe(false);
  });
});
