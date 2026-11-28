import { describe, expect, it } from 'vitest';

import { getRequestClientGeo } from './requestClientGeo';

describe('getRequestClientGeo', () => {
  it('never trusts location headers a caller can set', () => {
    const headers = new Headers({
      'cf-ipcountry': 'JP',
      'x-vercel-ip-city': 'Tokyo',
      'x-vercel-ip-country': 'JP',
    });

    expect(getRequestClientGeo(headers)).toBeUndefined();
  });
});
