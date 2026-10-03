import { getCodexPermissionConfig } from '@lobechat/types';
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

/** @example CLI-only approval policies never reach the app-server RPC contract. */
describe('Codex legacy approval transport compatibility', () => {
  // ROOT CAUSE:
  //
  // on-failure was accepted as AskForApproval even though that RPC union excludes it.
  // Desktop then forced app-server and prevented the existing codex exec fallback.
  // Keep CLI parsing intact while excluding this policy from app-server compatibility.

  /** @example Both flag and config spellings preserve on-failure for codex exec. */
  it.each([
    ['-a', 'on-failure'],
    ['--ask-for-approval=on-failure'],
    ['-c', 'approval_policy="on-failure"'],
    ['--config=approval_policy="on-failure"'],
  ])('keeps %j on the CLI transport', (...args) => {
    /** @example The shared CLI parser still recognizes the user's legacy policy. */
    expect(getCodexPermissionConfig(args).approvalPolicy).toBe('on-failure');
    /** @example Fresh app-server selection rejects CLI-only approval arguments. */
    expect(getCodexAppServerUnsupportedArgs(args)).toEqual([args[0]]);
    /** @example Native resume also rejects the unsupported RPC policy. */
    expect(getCodexAppServerUnsupportedArgs(args, { resume: true })).toEqual([args[0]]);
  });
});

/** @example Every generated reviewer value can be selected without coercion to user. */
describe('Codex guardian approval reviewer', () => {
  // ROOT CAUSE:
  //
  // ApprovalsReviewer includes guardian_subagent, but validation rejected it and the
  // builder mapped every reviewer except auto_review to user. Validate the complete
  // generated union and preserve the selected reviewer in the native thread params.

  /** @example Quoted and inline config syntax all preserve guardian_subagent. */
  it.each([
    ['-c', 'approvals_reviewer="guardian_subagent"'],
    ['--config=approvals_reviewer="guardian_subagent"'],
    ['-c', "approvals_reviewer='guardian_subagent'"],
  ])('accepts %j for starting and resuming a thread', (...reviewerArgs) => {
    const args = ['-a', 'on-request', '-s', 'workspace-write', ...reviewerArgs];
    /** @example Supported reviewer arguments stay on app-server for new threads. */
    expect(getCodexAppServerUnsupportedArgs(args)).toEqual([]);
    /** @example The same reviewer remains supported when resuming a native thread. */
    expect(getCodexAppServerUnsupportedArgs(args, { resume: true })).toEqual([]);
    /** @example Native top-level and config fields agree on the selected reviewer. */
    expect(buildCodexAppServerThreadParams(args, '/workspace')).toMatchObject({
      approvalPolicy: 'on-request',
      approvalsReviewer: 'guardian_subagent',
      config: { approvals_reviewer: 'guardian_subagent' },
      sandbox: 'workspace-write',
    });
  });

  /** @example Direct RPC construction never changes the selected guardian reviewer. */
  it('preserves guardian_subagent in native thread params', () => {
    /** @example Both RPC fields identify guardian_subagent rather than the default user. */
    expect(
      buildCodexAppServerThreadParams(
        ['-a', 'on-request', '-c', 'approvals_reviewer="guardian_subagent"'],
        '/workspace',
      ),
    ).toMatchObject({
      approvalPolicy: 'on-request',
      approvalsReviewer: 'guardian_subagent',
      config: { approvals_reviewer: 'guardian_subagent' },
    });
  });

  /** @example Unknown reviewer values still fail validation. */
  it('rejects reviewers outside the generated protocol', () => {
    /** @example A typo must not silently select the user reviewer. */
    expect(getCodexAppServerUnsupportedArgs(['-c', 'approvals_reviewer="guardian"'])).toEqual([
      '-c',
    ]);
  });
});
