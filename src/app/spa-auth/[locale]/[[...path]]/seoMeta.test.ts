import { describe, expect, it } from 'vitest';

import { buildAuthSeoEntry, buildSeoMeta } from './seoMeta';

describe('buildAuthSeoEntry', () => {
  it('maps /signin to signin metadata', async () => {
    const entry = await buildAuthSeoEntry('en-US', '/signin');

    expect(entry.canonicalPath).toBe('/signin');
    expect(entry.title).toBe('Sign In');
    expect(entry.description).toContain('account');
  });

  it('maps /signup to signup metadata', async () => {
    const entry = await buildAuthSeoEntry('en-US', '/signup');

    expect(entry.canonicalPath).toBe('/signup');
    expect(entry.title).toBe('Create Account');
    expect(entry.description).toBe('Start your Agents collaboration space');
  });

  it('falls back to branding for unmapped paths', async () => {
    const entry = await buildAuthSeoEntry('en-US', '/oauth/consent');

    expect(entry.canonicalPath).toBeUndefined();
    expect(entry.title).toBeTruthy();
    expect(entry.description).toBeTruthy();
  });
});

describe('buildSeoMeta', () => {
  it('joins canonical path onto official url for mapped paths', async () => {
    const meta = await buildSeoMeta('en-US', '/signin');

    expect(meta).toContain('<title>Sign In</title>');
    expect(meta).toContain('property="og:url" content="https://app.lobehub.com/signin"');
  });

  it('uses official url for unmapped paths', async () => {
    const meta = await buildSeoMeta('en-US', '/verify-email');

    expect(meta).toContain('property="og:url" content="https://app.lobehub.com"');
    expect(meta).toContain('property="og:locale" content="en-US"');
  });
});
