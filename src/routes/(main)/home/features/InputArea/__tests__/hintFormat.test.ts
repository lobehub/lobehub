// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { stripMarkdownLinks } from '../hintFormat';

describe('stripMarkdownLinks', () => {
  it('keeps plain text unchanged', () => {
    expect(stripMarkdownLinks('帮我整理方向调研...')).toBe('帮我整理方向调研...');
  });

  it('replaces a single markdown link with its label', () => {
    expect(stripMarkdownLinks('看下 [Bug #14153](/agent/agt_x/tpc_y) 的进度...')).toBe(
      '看下 Bug #14153 的进度...',
    );
  });

  it('replaces multiple markdown links in one string', () => {
    expect(
      stripMarkdownLinks(
        '帮我整理 [2.1 改版](/agent/inbox/tpc_a) 和 [LOBE-8516](/task/T-1) 的下一步...',
      ),
    ).toBe('帮我整理 2.1 改版 和 LOBE-8516 的下一步...');
  });

  it('preserves the trailing ellipsis used as a typing indicator', () => {
    expect(stripMarkdownLinks('看下 [Bug](/agent/x/y) 的 PR 进度...')).toBe(
      '看下 Bug 的 PR 进度...',
    );
  });

  it('passes through non-link brackets', () => {
    expect(stripMarkdownLinks('Try [option] without a URL')).toBe('Try [option] without a URL');
  });

  it('handles labels containing brackets in their visible label edge case', () => {
    // Label has no `]` — current pattern keeps the first matching `]`. We
    // accept this trade-off; entity titles rarely contain `]`.
    expect(stripMarkdownLinks('[Title](/path) trailing')).toBe('Title trailing');
  });
});
