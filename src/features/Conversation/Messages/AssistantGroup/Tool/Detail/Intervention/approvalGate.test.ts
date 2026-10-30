import { describe, expect, it } from 'vitest';

import {
  approveChoiceLabelKeys,
  canRememberViaAllowList,
  getApprovalChoices,
  isChoiceSubmitBlocked,
  resolveRememberAction,
} from './approvalGate';

describe('isChoiceSubmitBlocked', () => {
  it('holds both approve choices while the intervention blocks approval', () => {
    expect(isChoiceSubmitBlocked('approve', true)).toBe(true);
    expect(isChoiceSubmitBlocked('approve-remember', true)).toBe(true);
  });

  it('always lets the user reject', () => {
    expect(isChoiceSubmitBlocked('reject', true)).toBe(false);
  });

  it('lets every choice through when nothing blocks approval', () => {
    expect(isChoiceSubmitBlocked('approve', false)).toBe(false);
    expect(isChoiceSubmitBlocked('approve-remember')).toBe(false);
    expect(isChoiceSubmitBlocked('reject')).toBe(false);
  });
});

describe('getApprovalChoices', () => {
  const withRemember = ['approve', 'approve-remember', 'reject'];

  it('offers the shared remember choice in manual and allow-list modes', () => {
    for (const approvalMode of ['manual', 'allow-list']) {
      expect(
        getApprovalChoices({ allowListRememberable: true, approvalMode, toolRemember: false }),
      ).toEqual(withRemember);
    }
  });

  it('hides it when remembering could never take effect', () => {
    expect(
      getApprovalChoices({
        allowListRememberable: false,
        approvalMode: 'manual',
        toolRemember: false,
      }),
    ).toEqual(['approve', 'reject']);
    expect(
      getApprovalChoices({
        allowListRememberable: true,
        approvalMode: 'auto-run',
        toolRemember: false,
      }),
    ).toEqual(['approve', 'reject']);
  });

  it("offers it whenever the tool defines its own 'similar'", () => {
    expect(
      getApprovalChoices({
        allowListRememberable: false,
        approvalMode: 'manual',
        toolRemember: true,
      }),
    ).toEqual(withRemember);
  });
});

describe('resolveRememberAction', () => {
  it("uses the tool's own remember step, else the allow-list", () => {
    expect(resolveRememberAction({ toolRemember: true })).toBe('tool');
    expect(resolveRememberAction({ toolRemember: false })).toBe('allow-list');
  });
});

describe('canRememberViaAllowList', () => {
  it('allows tools that ask by default or by rule', () => {
    expect(canRememberViaAllowList({ config: 'required' })).toBe(true);
    expect(canRememberViaAllowList({ config: undefined })).toBe(true);
  });

  it('refuses calls that must always ask', () => {
    expect(canRememberViaAllowList({ config: 'always' })).toBe(false);
    expect(
      canRememberViaAllowList({ config: { dynamic: { policy: 'always', type: 'audit' } } }),
    ).toBe(false);
    expect(canRememberViaAllowList({ config: 'required', toolArgs: { command: 'rm -rf /' } })).toBe(
      false,
    );
  });
});

describe('approveChoiceLabelKeys', () => {
  it('lets each tool name its own approval so consecutive steps of one flow read differently', () => {
    const dryRun = approveChoiceLabelKeys({
      apiName: 'dryRunWidget',
      choice: 'approve',
      identifier: 'lobe-dashboard',
    });
    const publish = approveChoiceLabelKeys({
      apiName: 'requestPublish',
      choice: 'approve',
      identifier: 'lobe-dashboard',
    });
    expect(dryRun.tool).toBe('builtins.lobe-dashboard.approve.dryRunWidget');
    expect(publish.tool).toBe('builtins.lobe-dashboard.approve.requestPublish');
    expect(dryRun.shared).toBe('tool.intervention.optionApprove');
  });

  it('keys the remember choice apart from the plain approve', () => {
    expect(
      approveChoiceLabelKeys({
        apiName: 'dryRunWidget',
        choice: 'approve-remember',
        identifier: 'lobe-dashboard',
      }),
    ).toEqual({
      shared: 'tool.intervention.optionApproveRemember',
      tool: 'builtins.lobe-dashboard.approveRemember.dryRunWidget',
    });
  });
});
