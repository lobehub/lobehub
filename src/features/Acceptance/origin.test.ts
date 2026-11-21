import { describe, expect, it } from 'vitest';

import { acceptanceOrigin } from './origin';

describe('acceptanceOrigin', () => {
  it('moves the cloud gateway apex to the app origin', () => {
    // The apex serves `/acceptance/<id>` from the marketing site, not the app.
    expect(acceptanceOrigin('https://lobehub.com')).toBe('https://app.lobehub.com');
    expect(acceptanceOrigin('https://lobehub.com/')).toBe('https://app.lobehub.com');
  });

  it('keeps every other origin', () => {
    expect(acceptanceOrigin('https://app.lobehub.com')).toBe('https://app.lobehub.com');
    expect(acceptanceOrigin('https://chat.example.com')).toBe('https://chat.example.com');
    expect(acceptanceOrigin('http://localhost:3010')).toBe('http://localhost:3010');
    expect(acceptanceOrigin('')).toBe('');
  });
});
