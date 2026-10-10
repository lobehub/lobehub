import { describe, expect, it } from 'vitest';

import { buildCloudHeteroContext } from './cloudHeteroContext';

describe('buildCloudHeteroContext', () => {
  it('teaches sourcing ~/.creds/.env, not the decoy ~/.creds/env', () => {
    const result = buildCloudHeteroContext({
      githubToken: 'ghs_test_not_a_real_token',
      repos: [],
    });

    expect(result).toContain('source ~/.creds/.env');
    expect(result).not.toMatch(/source ~\/\.creds\/env(?!\.)/);
    expect(result).not.toContain('cat ~/.creds');
  });
});
