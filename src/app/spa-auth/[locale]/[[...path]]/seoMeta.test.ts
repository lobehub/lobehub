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

  it('uses hand-translated zh-CN keys', async () => {
    const signin = await buildAuthSeoEntry('zh-CN', '/signin');
    const signup = await buildAuthSeoEntry('zh-CN', '/signup');

    expect(signin.title).toBe('登录');
    expect(signup.title).toBe('创建账号');
    expect(signup.description).toBe('开启 Agents 协作空间');
  });

  it('strips a trailing slash before matching', async () => {
    const entry = await buildAuthSeoEntry('en-US', '/signin/');

    expect(entry.canonicalPath).toBe('/signin');
    expect(entry.title).toBe('Sign In');
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

  it('normalizes hostile locale input to an allowlisted value', async () => {
    const hostile = '"><script>alert(1)</script>';
    const meta = await buildSeoMeta(hostile, '/signin');

    expect(meta).not.toContain(hostile);
    expect(meta).not.toContain('alert(1)');
    expect(meta).toContain('property="og:locale" content="en-US"');
  });

  it('uses official url for unmapped paths', async () => {
    const meta = await buildSeoMeta('en-US', '/verify-email');

    expect(meta).toContain('property="og:url" content="https://app.lobehub.com"');
    expect(meta).toContain('property="og:locale" content="en-US"');
  });
});
