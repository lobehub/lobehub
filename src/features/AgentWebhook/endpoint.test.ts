import { describe, expect, it } from 'vitest';

import { curlExamples, KEY_PLACEHOLDER } from './endpoint';

const url = 'https://app.test/api/webhooks/inbound/0d6f';

describe('curlExamples', () => {
  it('posts to the fixed URL with the key as a Bearer header in every example', () => {
    const examples = curlExamples(url, 'k-123');
    for (const command of Object.values(examples)) {
      expect(command).toContain(`'${url}`);
      expect(command).toContain("-H 'Authorization: Bearer k-123'");
    }
    expect(examples.thread).toContain(`${url}?thread=ticket-42`);
    expect(examples.thread).toContain('Idempotency-Key');
  });

  it('shows a placeholder when the key is not at hand', () => {
    expect(curlExamples(url).text).toContain(`Bearer ${KEY_PLACEHOLDER}`);
  });
});
