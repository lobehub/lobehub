import { describe, expect, it } from 'vitest';

import { lobeHubCliGuide } from './lobeHubCliGuide';

describe('lobeHubCliGuide', () => {
  it('forbids replacing the installed lh and logging in', () => {
    expect(lobeHubCliGuide).toContain('Never install, upgrade or replace `lh` globally');
    expect(lobeHubCliGuide).toContain('never run `lh login`');
  });

  it('does not forbid running a newer CLI outright', () => {
    expect(lobeHubCliGuide).not.toMatch(/never install it/);
  });

  it('names a one-off latest-CLI run when the installed lh is too old', () => {
    expect(lobeHubCliGuide).toContain('`pnpm --package @lobehub/cli@latest dlx lh …`');
    expect(lobeHubCliGuide).toContain('`npx -y -p @lobehub/cli@latest lh …`');
  });
});
