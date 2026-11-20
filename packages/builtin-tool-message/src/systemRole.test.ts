import { describe, expect, it } from 'vitest';

import { systemPrompt } from './systemRole';

/**
 * Asked for an editable Feishu document, a device-run bot with no way to create
 * one searched the local LobeHub database for the app secret, sent a .docx to
 * the group, then drove the Feishu UI until the run was interrupted. The Feishu
 * notes point at lark-cli instead and keep these guard rails.
 */
describe('Message systemRole — Feishu / Lark beyond messaging', () => {
  it('routes document creation to lark-cli as the user', () => {
    expect(systemPrompt).toContain('lark-cli docs +create --as user');
    expect(systemPrompt).toContain('npx -y @larksuite/cli');
  });

  it('logs in without blocking and keeps the links with the bot owner', () => {
    expect(systemPrompt).toContain('--no-wait --json');
    expect(systemPrompt).toMatch(/end your turn/);
    expect(systemPrompt).toMatch(/only to the bot owner/);
  });

  it('forbids credential hunting, UI driving and attachment substitutes', () => {
    expect(systemPrompt).toMatch(
      /Never search the device for the app secret, drive the Feishu UI, or send a file attachment/,
    );
  });
});
