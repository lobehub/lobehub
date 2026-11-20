import { describe, expect, it } from 'vitest';

import { createSecretRedactor, createStreamingRedactor, secretVariants } from '../src';

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

    // `efg` is a proper prefix of `efgh`, but `abcdef` is already complete at offset 6. Redacting
    // it whole must not leave `abcd` behind for the next chunk to extend into `abcdefgX`.
    expect(stream.push('abcdefg')).toBe('«secret:long»g');
    expect(stream.push('X')).toBe('X');
    expect(stream.flush()).toBe('');
  });

  it('redacts a self-overlapping variant as soon as it completes', () => {
    const redactor = createSecretRedactor();
    redactor.add('repeat', 'aaaa');
    const stream = createStreamingRedactor(redactor);

    // `aaa` is a proper prefix of `aaaa`, so it is carried; the fourth `a` completes a match and is
    // redacted at once, keeping the carry (never the whole stream) bounded.
    expect(stream.push('aaa')).toBe('');
    expect(stream.push('a')).toBe('«secret:repeat»');
    expect(stream.push('a')).toBe('');
    expect(stream.push('aaa')).toBe('«secret:repeat»');
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

  it('never re-emits a registered variant, whatever the chunking', () => {
    const values = ['aaaa', 'aaab', 'abab'];
    const redactor = createSecretRedactor();
    for (const value of values) redactor.add('s', value);
    const variants = values.flatMap(secretVariants);

    const expectNoLeak = (out: string, label: string) => {
      for (const variant of variants)
        expect(out.includes(variant), `${label} leaked ${variant}`).toBe(false);
    };

    const text = 'aaabaaaaaab abab aaaa aaab aabababaaa';
    for (let split = 0; split <= text.length; split++) {
      const stream = createStreamingRedactor(redactor);
      expectNoLeak(
        stream.push(text.slice(0, split)) + stream.push(text.slice(split)) + stream.flush(),
        `split ${split}`,
      );
    }

    let seed = 1;
    const next = () => (seed = (seed * 48271) % 2147483647);
    for (let round = 0; round < 200; round++) {
      const stream = createStreamingRedactor(redactor);
      let out = '';
      for (let i = 0, chunks = next() % 50; i < chunks; i++)
        out += stream.push('ab'[next() % 2] + 'ab'[next() % 2] + 'ab'[next() % 2]);
      out += stream.flush();
      expectNoLeak(out, `round ${round}`);
    }
  });
});
