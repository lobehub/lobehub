import { describe, expect, it } from 'vitest';

import { getCodexApprovalDecisions } from './approvalOptions';

describe('getCodexApprovalDecisions', () => {
  it('uses only the decisions advertised by Codex', () => {
    const execPolicyDecision = {
      acceptWithExecpolicyAmendment: {
        execpolicy_amendment: ['/usr/bin/curl', '-I', 'https://github.com'],
      },
    };

    expect(
      getCodexApprovalDecisions('command_execution', {
        availableDecisions: ['accept', execPolicyDecision, 'cancel'],
      }),
    ).toEqual(['accept', execPolicyDecision, 'cancel']);
  });

  it('drops malformed or unadvertised decisions', () => {
    expect(
      getCodexApprovalDecisions('command_execution', {
        availableDecisions: [
          'accept',
          'acceptForSession',
          { acceptWithExecpolicyAmendment: { execpolicy_amendment: [42] } },
          'unsupported',
          'cancel',
        ],
      }),
    ).toEqual(['accept', 'acceptForSession', 'cancel']);
  });

  it('infers the legacy similar-command decision from the proposed amendment', () => {
    expect(
      getCodexApprovalDecisions('command_execution', {
        proposedExecpolicyAmendment: ['git', 'status'],
      }),
    ).toEqual([
      'accept',
      { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['git', 'status'] } },
      'cancel',
    ]);
  });

  it('uses the fixed file-change choices while Codex does not advertise them', () => {
    expect(getCodexApprovalDecisions('file_change', {})).toEqual([
      'accept',
      'acceptForSession',
      'cancel',
    ]);
  });

  it('honors advertised file-change choices when Codex adds them', () => {
    expect(
      getCodexApprovalDecisions('file_change', { availableDecisions: ['accept', 'cancel'] }),
    ).toEqual(['accept', 'cancel']);
  });
});
