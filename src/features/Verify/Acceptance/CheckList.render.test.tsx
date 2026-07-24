import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { type AcceptanceCheck, CheckRow } from './CheckList';

const failedCheck = {
  evidence: [],
  id: 'check-8',
  introducedAtRound: 1,
  required: true,
  result: null,
  reviews: [],
  revisions: 1,
  seq: 8,
  state: 'failed',
  timeline: [],
  title: '真实失败检查项从 Task 右侧展开详情',
  titleChanged: false,
  userReview: null,
} as unknown as AcceptanceCheck;

describe('Acceptance CheckRow detail variant', () => {
  it('separates the status pill from a large check title', () => {
    const { container, getByText } = render(
      <CheckRow
        expanded
        canReview={false}
        check={failedCheck}
        reviewPending={false}
        variant={'panel'}
        onReview={vi.fn()}
        onRound={vi.fn()}
        onToggle={vi.fn()}
      />,
    );

    const row = container.querySelector('[data-check-row="check-8"]')!;
    const header = row.firstElementChild!;
    const title = getByText(failedCheck.title);

    expect(header.textContent).toContain('report.verdict.failed');
    expect(header.querySelector('[data-lucide="chevron-right"]')).toBeNull();
    expect(title).toHaveStyle({ fontSize: '20px', fontWeight: '600' });
  });
});
