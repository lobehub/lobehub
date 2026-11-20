import { describe, expect, it } from 'vitest';

import { createSecretRedactor, createStreamingRedactor, secretVariants } from '../src';

const expectNoVariant = (out: string, variants: string[]) => {
  for (const variant of variants) expect(out.includes(variant), `leaked ${variant}`).toBe(false);
};

describe('placeholder collision', () => {
  it('keeps the plain §7.4 placeholder when the secret cannot appear in it', () => {
    const redactor = createSecretRedactor();
    redactor.add('sudo-password', 'hunter2-TEST');

    expect(redactor.redact('hunter2-TEST')).toBe('«secret:sudo-password»');
    expect(redactor.redact('my hunter2-TEST here')).toBe('my «secret:sudo-password» here');
  });

  it('[ASC-L3-09] does not let a secret survive through the `secret` in its placeholder', () => {
    const redactor = createSecretRedactor();
    redactor.add('x', 'secret');

    const out = redactor.redact('x secret and secret');
    expectNoVariant(out, secretVariants('secret'));
    expect(out).toContain('«');
  });

  it('[ASC-L3-09] does not let a secret survive through its own label', () => {
    const redactor = createSecretRedactor();
    redactor.add('password', 'password');

    expectNoVariant(redactor.redact('password'), secretVariants('password'));
  });

  it('[ASC-L3-09] covers the streaming redactor too', () => {
    const redactor = createSecretRedactor();
    redactor.add('x', 'secret');
    const stream = createStreamingRedactor(redactor);

    let out = '';
    for (const char of 'the secret is secret') out += stream.push(char);
    out += stream.flush();

    expectNoVariant(out, secretVariants('secret'));
  });

  it('[ASC-L3-09] does not let a placeholder compose a secret with its neighbours', () => {
    const redactor = createSecretRedactor();
    redactor.add('boundary', '»abcdef');
    redactor.add('source', 'WXYZ');
    const variants = [...secretVariants('»abcdef'), ...secretVariants('WXYZ')];

    // The plain `«secret:source»` would end in `»`, and the `abcdef` that follows it off the end of
    // the match would complete the registered variant `»abcdef`.
    expectNoVariant(redactor.redact('WXYZabcdef'), variants);

    const stream = createStreamingRedactor(redactor);
    let streamed = '';
    for (const char of 'WXYZabcdef') streamed += stream.push(char);
    streamed += stream.flush();
    expectNoVariant(streamed, variants);
  });

  it('escapes only the placeholders that collide', () => {
    const redactor = createSecretRedactor();
    redactor.add('password', 'password');
    redactor.add('fine', 'hunter2-TEST');

    expect(redactor.redact('hunter2-TEST')).toBe('«secret:fine»');
    expectNoVariant(redactor.redact('password'), secretVariants('password'));
  });
});
