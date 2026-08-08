import { describe, expect, it } from 'vitest';

import { classifyGreetingHref } from '../greetingLink';

describe('classifyGreetingHref', () => {
  it('allows app-relative and HTTP(S) greeting links', () => {
    expect(classifyGreetingHref('/task/T-1')).toBe('internal');
    expect(classifyGreetingHref('https://lobehub.com/news')).toBe('external');
    expect(classifyGreetingHref('http://localhost:3010/task/T-1')).toBe('external');
  });

  it('rejects executable and protocol-relative links', () => {
    expect(classifyGreetingHref('javascript:alert(1)')).toBe('unsafe');
    expect(classifyGreetingHref('data:text/html,hello')).toBe('unsafe');
    expect(classifyGreetingHref('//example.com/path')).toBe('unsafe');
  });
});
