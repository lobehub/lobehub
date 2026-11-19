import { describe, expect, it } from 'vitest';

import { receiptErrorText } from './MessageReceipts';

const t = (key: string) => key;

describe('receiptErrorText', () => {
  // A shared Agent's visitor gets no raw failure text; the category must still explain a cap.
  it('explains a shared Agent’s spend-limit refusal in the viewer’s language', () => {
    expect(
      receiptErrorText({ errorMessage: 'monthly limit', errorType: 'ShareSpendLimitExceeded' }, t),
    ).toBe('receipt.errorShareSpendLimit');
  });

  it('explains a shared Claude Code / Codex Agent’s device refusals', () => {
    expect(
      receiptErrorText({ errorMessage: 'x', errorType: 'ShareHeterogeneousAgentUnsupported' }, t),
    ).toBe('receipt.errorShareHeteroUnsupported');
    expect(
      receiptErrorText({ errorMessage: 'x', errorType: 'ShareHeteroDeviceUnavailable' }, t),
    ).toBe('receipt.errorShareHeteroDevice');
  });

  it('explains a shared Agent’s per-visitor message-limit refusal', () => {
    expect(
      receiptErrorText(
        { errorMessage: 'ShareMessageLimitExceeded', errorType: 'ShareMessageLimitExceeded' },
        t,
      ),
    ).toBe('receipt.errorShareMessageLimit');
  });

  it('shows the recorded reason, or the fallback when none was recorded', () => {
    expect(receiptErrorText({ errorMessage: ' boom ', errorType: null }, t)).toBe('boom');
    expect(receiptErrorText({ errorMessage: null, errorType: 'AgentRuntimeError' }, t)).toBe(
      'receipt.errorUnavailable',
    );
  });
});
