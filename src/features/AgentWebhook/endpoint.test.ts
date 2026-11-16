import { describe, expect, it } from 'vitest';

import { curlExamples, maskEndpoint } from './endpoint';

const url = 'https://app.test/api/webhooks/inbound/0d6f/abcdEFGHijklMNOPqrstUVWX';

describe('maskEndpoint', () => {
  it('keeps the start and end of the token only', () => {
    expect(maskEndpoint(url)).toBe('https://app.test/api/webhooks/inbound/0d6f/abcd••••UVWX');
  });

  it('leaves a URL without a long token as it is', () => {
    expect(maskEndpoint('https://app.test/x/short')).toBe('https://app.test/x/short');
  });
});

describe('curlExamples', () => {
  it('uses the full URL in every example', () => {
    const examples = curlExamples(url);
    for (const command of Object.values(examples)) expect(command).toContain(url);
    expect(examples.thread).toContain(`${url}?thread=ticket-42`);
    expect(examples.thread).toContain('Idempotency-Key');
  });
});
