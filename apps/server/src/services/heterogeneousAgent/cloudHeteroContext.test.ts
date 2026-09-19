import { describe, expect, it } from 'vitest';

import { buildCloudHeteroContext } from './cloudHeteroContext';

describe('buildCloudHeteroContext', () => {
  it('always primes the LobeHub CLI section — the sandbox ships an authenticated `lh`', () => {
    const context = buildCloudHeteroContext({ repos: [] });

    expect(context).toContain('## LobeHub CLI (`lh`)');
    // CC must be told auth is already wired, or it will never try `lh`.
    expect(context).toContain('LOBEHUB_JWT');
    expect(context).toContain('LOBEHUB_SERVER');
    expect(context).toContain('without `lh login`');
    // And told what NOT to do: no nested runs / daemons.
    expect(context).toContain('`lh hetero exec`');
    expect(context).toContain('`lh connect`');
  });

  it('keeps the CLI section when GitHub auth and repos are present', () => {
    const context = buildCloudHeteroContext({
      githubToken: 'gho_test',
      repos: ['lobehub/lobe-chat'],
    });

    expect(context).toContain('## LobeHub CLI (`lh`)');
    expect(context).toContain('## GitHub Authentication');
    expect(context).toContain('## GitHub Repositories');
    // CLI section sits with the infra context, before the repo listing.
    expect(context.indexOf('## LobeHub CLI')).toBeLessThan(
      context.indexOf('## GitHub Repositories'),
    );
  });

  it('places agent-level static context ahead of the workspace/CLI infra context', () => {
    const context = buildCloudHeteroContext({
      agentSystemContext: 'Team conventions: always use pnpm.',
      repos: [],
    });

    expect(context.indexOf('Team conventions')).toBeLessThan(context.indexOf('## LobeHub CLI'));
  });
});
