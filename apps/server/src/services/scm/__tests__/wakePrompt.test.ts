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
    { conclusion: 'failure', externalId: 'check_run:4', name: 'Build "x"', status: 'completed' },
    { conclusion: 'cancelled', externalId: 'check_run:5', name: 'Cancelled', status: 'completed' },
    { conclusion: 'skipped', externalId: 'check_run:6', name: 'Skipped', status: 'completed' },
    { conclusion: 'neutral', externalId: 'check_run:7', name: 'Neutral', status: 'completed' },
    { externalId: 'check_run:3', name: 'Deploy', status: 'in_progress' },
  ],
  headRef: 'feat/x',
  headSha: 'abcdef0123456789',
  number: 7,
  provider: 'github',
  repoFullName: 'o/r',
  url: 'https://github.com/o/r/pull/7',
} as unknown as ScmChangeRequestItem;

/** CommonMark closes an HTML block at the first blank line; the block must not contain one. */
const hasBlankLine = (text: string) => /\n\s*\n/.test(text);

describe('buildCiFailurePrompt', () => {
  it('emits one scmEvent block with failed checks, their log tails and the instruction', () => {
    const prompt = buildCiFailurePrompt({
      logs: { 'check_run:2': 'FAIL src/a.test.ts\n\n  expected 1\n\n' },
      row,
    });

    expect(prompt.startsWith('<scmEvent ')).toBe(true);
    expect(prompt.endsWith('</scmEvent>')).toBe(true);
    expect(prompt).toContain(
      'branch="feat/x" kind="ci_failed" number="7" provider="github" repo="o/r" sha="abcdef0" url="https://github.com/o/r/pull/7"',
    );
    expect(prompt).toContain(
      '<check conclusion="failure" name="Test" url="https://github.com/o/r/actions/runs/9/job/2">',
    );
    expect(prompt).toContain('<log><![CDATA[\nFAIL src/a.test.ts\n  expected 1\n]]></log>');
    // A failing check without a log is self-closing; attribute values are escaped.
    expect(prompt).toContain('<check conclusion="failure" name="Build &quot;x&quot;" />');
    expect(prompt).not.toContain('name="Lint"');
    expect(prompt).not.toContain('name="Deploy"');
    // Cancelled / skipped / neutral runs completed without failing; asking
    // the agent to fix them would send it after a check that never ran.
    expect(prompt).not.toContain('name="Cancelled"');
    expect(prompt).not.toContain('name="Skipped"');
    expect(prompt).not.toContain('name="Neutral"');
    expect(prompt).toContain(
      '<instruction>\nGitHub reported a failing check on pull request o/r#7',
    );
    expect(prompt).toContain('push the fix to the branch `feat/x`');
    expect(hasBlankLine(prompt)).toBe(false);
  });

  it('keeps a CDATA terminator inside a log from ending the section', () => {
    const prompt = buildCiFailurePrompt({ logs: { 'check_run:2': 'a ]]> b' }, row });
    expect(prompt).toContain('a ]]]]><![CDATA[> b');
  });
});

describe('buildReviewPrompt', () => {
  it('renders review bodies and inline comments with their location', () => {
    const prompt = buildReviewPrompt({
      feedback: [
        {
          association: 'collaborator' as const,
          author: 'codex',
          body: 'Please split the handler.',
          state: 'CHANGES_REQUESTED',
          url: 'https://github.com/o/r/pull/7#pullrequestreview-1',
        },
        {
          association: 'member' as const,
          author: 'codex',
          body: 'Guard is inverted.\n\nSee line 40.',
          line: 42,
          path: 'src/x.ts',
        },
      ],
      reason: 'review_changes_requested',
      row,
    });

    expect(prompt).toContain('kind="review_changes_requested"');
    expect(prompt).toContain(
      '<review author="codex" state="changes_requested" url="https://github.com/o/r/pull/7#pullrequestreview-1"><![CDATA[\nPlease split the handler.\n]]></review>',
    );
    expect(prompt).toContain(
      '<review author="codex" line="42" path="src/x.ts"><![CDATA[\nGuard is inverted.\nSee line 40.\n]]></review>',
    );
    expect(prompt).toContain('A reviewer requested changes on pull request o/r#7');
    expect(hasBlankLine(prompt)).toBe(false);
  });

  it('says so when the review carried no text', () => {
    const prompt = buildReviewPrompt({ feedback: [], reason: 'review_commented', row });
    expect(prompt).not.toContain('<review');
    expect(prompt).toContain('Reviewers left feedback on pull request o/r#7');
    expect(prompt).toContain('The review carried no text');
  });
});
