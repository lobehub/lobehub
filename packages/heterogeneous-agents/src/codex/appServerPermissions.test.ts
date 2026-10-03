import { describe, expect, it } from 'vitest';

import {
  buildCodexAppServerThreadParams,
  getCodexAppServerUnsupportedArgs,
} from './appServerParams';

/** @example A requested approval policy survives both fresh and resumed app-server threads. */
describe('Codex app-server explicit permission policies', () => {
  // ROOT CAUSE:
  //
  // Explicit approval arguments were skipped while sandbox arguments were parsed.
  // The builder always returned approvalPolicy: 'never', and the compatibility
  // check rejected all non-never approvals before app-server could use them.
  // Preserve both selected policies and keep supported approvals on app-server.

  /** @example Workspace writes keep on-request approval instead of silently becoming never. */
  it('preserves workspace-write with on-request on start and resume', () => {
    const args = ['--sandbox', 'workspace-write', '--ask-for-approval', 'on-request'];
    /** @example The RPC payload carries the policy the user chose. */
    expect(buildCodexAppServerThreadParams(args, '/workspace')).toMatchObject({
      approvalPolicy: 'on-request',
      sandbox: 'workspace-write',
    });
    /** @example This supported combination does not trigger generic-exec fallback. */
    expect(getCodexAppServerUnsupportedArgs(args)).toEqual([]);
    /** @example Resuming applies the same supported configuration. */
    expect(getCodexAppServerUnsupportedArgs(args, { resume: true })).toEqual([]);
  });

  /** @example Read-only sessions retain the stricter untrusted command approval policy. */
  it('preserves read-only with untrusted approval', () => {
    const args = ['-s', 'read-only', '-a', 'untrusted'];
    /** @example Both raw arguments survive parameter construction. */
    expect(buildCodexAppServerThreadParams(args, '/workspace')).toMatchObject({
      approvalPolicy: 'untrusted',
      sandbox: 'read-only',
    });
    /** @example A valid policy is accepted when restoring a thread. */
    expect(getCodexAppServerUnsupportedArgs(args, { resume: true })).toEqual([]);
  });

  /** @example Config assignments and long flags express the same approval policy. */
  it('preserves approval_policy config overrides', () => {
    const args = ['-c', 'sandbox_mode="workspace-write"', '-c', 'approval_policy="on-request"'];
    /** @example Top-level RPC configuration agrees with the explicit config override. */
    expect(buildCodexAppServerThreadParams(args, '/workspace')).toMatchObject({
      approvalPolicy: 'on-request',
      sandbox: 'workspace-write',
    });
    /** @example A supported config assignment is not discarded by transport selection. */
    expect(getCodexAppServerUnsupportedArgs(args)).toEqual([]);
  });
});
