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

  it('picks a hand-off path by what is needed back, and teaches sub-topics through lh topic', () => {
    expect(lobeHubCliGuide).toContain('the result inside this turn');
    expect(lobeHubCliGuide).toContain('lh topic send --new -c');
    expect(lobeHubCliGuide).toContain('--where new-worktree');
    expect(lobeHubCliGuide).toContain('do not poll');
    expect(lobeHubCliGuide).toContain('<sub_topic_result>');
    expect(lobeHubCliGuide).toContain('lh topic send <tpc_id>');
    expect(lobeHubCliGuide).toContain('lh topic list --opened-by-me');
    expect(lobeHubCliGuide).toContain('`lh task`');
    expect(lobeHubCliGuide).not.toContain('lh session');
  });
});
