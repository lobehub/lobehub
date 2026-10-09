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

  it('never emits a completed match that overlaps a trailing prefix', () => {
    const redactor = createSecretRedactor();
    redactor.add('long', 'abcdef');
    redactor.add('short', 'efgh');
    const stream = createStreamingRedactor(redactor);

    // `efg` is a proper prefix of `efgh`, but `abcdef` ends at offset 6: cutting at 4 would emit
    // `abcd`, retain `efg`, and let the next chunk reconstruct the unredacted `abcdefgX`.
    expect(stream.push('abcdefg')).toBe('');
    expect(stream.push('X')).toBe('«secret:long»gX');
    expect(stream.flush()).toBe('');
  });

  it('matches a whole-buffer redaction for every chunk split', () => {
    const redactor = createSecretRedactor();
    redactor.add('long', 'abcdef');
    redactor.add('short', 'efgh');
    const text = 'abcdefgh and abcdef and efgh and abcdefgX';
    const expected = redactor.redact(text);

    for (let split = 0; split <= text.length; split++) {
      const stream = createStreamingRedactor(redactor);
      const out =
        stream.push(text.slice(0, split)) + stream.push(text.slice(split)) + stream.flush();
      expect(out, `split at ${split}`).toBe(expected);
    }
  });
});
