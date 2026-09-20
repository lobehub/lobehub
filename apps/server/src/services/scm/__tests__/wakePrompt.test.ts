import { describe, expect, it } from 'vitest';

import type { ScmChangeRequestItem } from '@/database/schemas';

import { buildCiFailurePrompt, buildReviewPrompt } from '../wakePrompt';

const row = {
  checks: [
    { conclusion: 'success', externalId: 'check_run:1', name: 'Lint', status: 'completed' },
    {
      conclusion: 'failure',
      externalId: 'check_run:2',
      name: 'Test',
      status: 'completed',
      url: 'https://github.com/o/r/actions/runs/9/job/2',
    },
    { externalId: 'check_run:3', name: 'Build', status: 'in_progress' },
  ],
  headRef: 'feat/x',
  headSha: 'abcdef0123456789',
  number: 7,
  repoFullName: 'o/r',
  url: 'https://github.com/o/r/pull/7',
} as unknown as ScmChangeRequestItem;

describe('buildCiFailurePrompt', () => {
  it('lists only failed checks, quotes the log we have, and names the branch', () => {
    const prompt = buildCiFailurePrompt({ logs: { 'check_run:2': 'FAIL src/a.test.ts\n' }, row });

    expect(prompt).toContain('o/r#7 (https://github.com/o/r/pull/7)');
    expect(prompt).toContain('CI failed on commit abcdef0');
    expect(prompt).toContain('- Test: failure (https://github.com/o/r/actions/runs/9/job/2)');
    expect(prompt).not.toContain('- Lint');
    expect(prompt).not.toContain('- Build');
    expect(prompt).toContain('Log tail for "Test":\n```\nFAIL src/a.test.ts\n```');
    expect(prompt).toContain('`feat/x`');
  });
});

describe('buildReviewPrompt', () => {
  it('renders review bodies and inline comments with their location', () => {
    const prompt = buildReviewPrompt({
      feedback: [
        { author: 'codex', body: 'Please split the handler.', state: 'CHANGES_REQUESTED' },
        { author: 'codex', body: 'Guard is inverted.', line: 42, path: 'src/x.ts' },
      ],
      reason: 'review_changes_requested',
      row,
    });

    expect(prompt).toContain('A reviewer requested changes:');
    expect(prompt).toContain('- @codex [changes_requested]: Please split the handler.');
    expect(prompt).toContain('- @codex on `src/x.ts`:42: Guard is inverted.');
  });

  it('says so when the review carried no text', () => {
    const prompt = buildReviewPrompt({ feedback: [], reason: 'review_commented', row });
    expect(prompt).toContain('Reviewers left feedback:');
    expect(prompt).toContain('The review had no text');
  });
});
