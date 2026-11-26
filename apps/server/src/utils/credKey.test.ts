import { describe, expect, it } from 'vitest';

import { generateCredKey, resolveCredKey } from './credKey';

describe('generateCredKey', () => {
  it('slugifies the name and appends a 6-character suffix', () => {
    expect(generateCredKey('OpenAI API Key')).toMatch(/^openai-api-key-[\da-z]{6}$/);
  });

  it('falls back to cred when the name has no ASCII letters or digits', () => {
    expect(generateCredKey('我的测试环境变量')).toMatch(/^cred-[\da-z]{6}$/);
  });

  it('keeps only the ASCII part of a mixed name', () => {
    expect(generateCredKey('飞书小葵 App Secret')).toMatch(/^app-secret-[\da-z]{6}$/);
  });

  it('keeps accented words whole', () => {
    expect(generateCredKey('Résumé token')).toMatch(/^resume-token-[\da-z]{6}$/);
  });

  it('caps the slug length and never ends it with a hyphen', () => {
    const key = generateCredKey(`${'a'.repeat(39)} b`);
    expect(key).toMatch(/^a{39}-[\da-z]{6}$/);
  });

  it('produces keys that pass the credential key pattern', () => {
    expect(generateCredKey('Vercel Token (lobehub-pro)')).toMatch(/^[\w-]+$/);
  });

  it('differs between calls for the same name', () => {
    expect(generateCredKey('Same')).not.toBe(generateCredKey('Same'));
  });
});

describe('resolveCredKey', () => {
  it('keeps a caller-supplied key', () => {
    expect(resolveCredKey({ key: 'claude-code', name: 'Anything' })).toBe('claude-code');
  });

  it('generates a key when none is supplied', () => {
    expect(resolveCredKey({ name: 'GitHub Token' })).toMatch(/^github-token-[\da-z]{6}$/);
  });

  it('generates a key when the supplied key is blank', () => {
    expect(resolveCredKey({ key: '  ', name: 'GitHub Token' })).toMatch(/^github-token-/);
  });
});
