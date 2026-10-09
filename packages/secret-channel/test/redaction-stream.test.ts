import { describe, expect, it } from 'vitest';

import { createSecretRedactor, createStreamingRedactor } from '../src';

describe('streaming redaction', () => {
  it('keeps a longer variant whole when a shorter one is its prefix', () => {
    const redactor = createSecretRedactor();
    redactor.add('short', 'abcd');
    redactor.add('long', 'abcdef');
    const stream = createStreamingRedactor(redactor);

    expect(stream.push('abcd')).toBe('');
    expect(stream.push('ef')).toBe('«secret:long»');
    expect(stream.flush()).toBe('');
  });

  it('redacts a secret split across arbitrary chunk boundaries', () => {
    const redactor = createSecretRedactor();
    redactor.add('token', 'sk-test-TOKEN');
    const stream = createStreamingRedactor(redactor);

    let out = '';
    for (const char of 'x sk-test-TOKEN y') out += stream.push(char);
    out += stream.flush();

    expect(out).toBe('x «secret:token» y');
  });

  it('holds a variant back until the stream ends instead of emitting its prefix', () => {
    const redactor = createSecretRedactor();
    redactor.add('token', 'sk-test-TOKEN');
    const stream = createStreamingRedactor(redactor);

    expect(stream.push('sk-test-')).toBe('');
    expect(stream.push('TOKEN')).toBe('«secret:token»');
    expect(stream.flush()).toBe('');
  });
});
