import { describe, expect, it } from 'vitest';

import {
  buildToolRejectionReason,
  composeToolRejectionReason,
  formatToolRejectionContent,
  isUserToolRejectionContent,
  normalizeToolRejectionReason,
  parseToolRejectionReason,
} from './toolRejection';

describe('toolRejection', () => {
  it.each([undefined, null, '', '   '])('fills a default for an empty reason (%j)', (reason) => {
    expect(normalizeToolRejectionReason(reason)).toBe(buildToolRejectionReason('unspecified'));
    expect(formatToolRejectionContent(reason)).not.toContain('without reason');
  });

  it('keeps a reason the user wrote', () => {
    expect(normalizeToolRejectionReason('  use trash instead ')).toBe('use trash instead');
  });

  it('composes the card input into a coded reason', () => {
    expect(composeToolRejectionReason({})).toBe(buildToolRejectionReason('unspecified'));
    expect(composeToolRejectionReason({ note: 'wrong repo' })).toBe('[other] wrong repo');
    expect(composeToolRejectionReason({ code: 'too_risky' })).toBe(
      '[too_risky] This action is too risky.',
    );
    expect(composeToolRejectionReason({ code: 'wrong_arguments', note: 'wrong repo' })).toBe(
      '[wrong_arguments] wrong repo',
    );
  });

  it('parses coded and plain reasons', () => {
    expect(parseToolRejectionReason('[too_risky] This action is too risky.')).toEqual({
      code: 'too_risky',
      isDefaultText: true,
      text: 'This action is too risky.',
    });
    expect(parseToolRejectionReason('[other] wrong repo')).toEqual({
      code: 'other',
      isDefaultText: false,
      text: 'wrong repo',
    });
    expect(parseToolRejectionReason('[draft] keep brackets')).toEqual({
      isDefaultText: false,
      text: '[draft] keep brackets',
    });
  });

  it('recognizes new and historical rejection content', () => {
    expect(isUserToolRejectionContent(formatToolRejectionContent('x'))).toBe(true);
    expect(isUserToolRejectionContent('User reject this tool calling without reason')).toBe(true);
    expect(isUserToolRejectionContent('Tool call rejected: no available tool')).toBe(false);
  });
});
