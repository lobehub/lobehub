import { describe, expect, it } from 'vitest';

import { parseAttributes, parseScmEvent, safeScmUrl } from './parseScmEvent';

// Mirrors what apps/server/src/services/scm/wakePrompt.ts emits.
const ciInner = `<check conclusion="failure" name="Test" url="https://github.com/o/r/actions/runs/9/job/2">
<log><![CDATA[
FAIL src/a.test.ts
  expected 1
]]></log>
</check>
<check conclusion="failure" name="Build &quot;x&quot;" />
<instruction>
GitHub reported a failing check on pull request o/r#7, which you opened from this conversation. Investigate the failure and fix it.
</instruction>`;

const reviewInner = `<review author="codex" state="changes_requested" url="https://github.com/o/r/pull/7#pullrequestreview-1"><![CDATA[
Please split the handler.
]]></review>
<review author="codex" line="42" path="src/x.ts"><![CDATA[
Guard is inverted.
See line 40.
]]></review>
<instruction>
A reviewer requested changes on pull request o/r#7.
</instruction>`;

describe('parseScmEvent', () => {
  it('reads checks with their log tails, self-closing checks, and the instruction', () => {
    const parsed = parseScmEvent(ciInner);
    expect(parsed.checks).toEqual([
      {
        conclusion: 'failure',
        log: 'FAIL src/a.test.ts\n  expected 1',
        name: 'Test',
        url: 'https://github.com/o/r/actions/runs/9/job/2',
      },
      { conclusion: 'failure', log: undefined, name: 'Build "x"', url: undefined },
    ]);
    expect(parsed.reviews).toEqual([]);
    expect(parsed.instruction).toBe(
      'GitHub reported a failing check on pull request o/r#7, which you opened from this conversation. Investigate the failure and fix it.',
    );
  });

  it('reads reviews with their location and state', () => {
    const parsed = parseScmEvent(reviewInner);
    expect(parsed.reviews).toEqual([
      {
        author: 'codex',
        body: 'Please split the handler.',
        line: undefined,
        path: undefined,
        state: 'changes_requested',
        url: 'https://github.com/o/r/pull/7#pullrequestreview-1',
      },
      {
        author: 'codex',
        body: 'Guard is inverted.\nSee line 40.',
        line: 42,
        path: 'src/x.ts',
        state: undefined,
        url: undefined,
      },
    ]);
  });

  it('joins a log whose CDATA had to be split around a terminator', () => {
    const parsed = parseScmEvent(
      '<check name="T"><log><![CDATA[\na ]]]]><![CDATA[> b\n]]></log></check>',
    );
    expect(parsed.checks[0].log).toBe('a ]]> b');
  });

  it('degrades to an empty event on garbage', () => {
    expect(parseScmEvent('')).toEqual({ checks: [], reviews: [] });
    expect(parseScmEvent('<check>')).toEqual({ checks: [], reviews: [] });
  });

  it('unescapes attribute values', () => {
    expect(parseAttributes('repo="o/r" name="a &amp; b &lt;c&gt;"')).toEqual({
      name: 'a & b <c>',
      repo: 'o/r',
    });
  });
});

describe('safeScmUrl', () => {
  it('keeps http(s) and drops every other scheme', () => {
    expect(safeScmUrl('https://github.com/o/r/pull/7')).toBe('https://github.com/o/r/pull/7');
    expect(safeScmUrl('http://localhost:3000/x')).toBe('http://localhost:3000/x');
    // The block is markdown anyone can write, and on desktop a click on the
    // card's anchor reaches shell.openExternal — an OS handler must not be
    // one message away.
    for (const hostile of [
      'vscode://file/etc/passwd',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'not a url',
      '',
    ]) {
      expect(safeScmUrl(hostile)).toBeUndefined();
    }
    expect(safeScmUrl(undefined)).toBeUndefined();
  });

  it('strips a hostile url off the parsed checks and reviews', () => {
    const parsed = parseScmEvent(
      '<check name="Test" url="vscode://file/etc/passwd" />' +
        '<review author="a" url="javascript:alert(1)"><![CDATA[hi]]></review>',
    );

    expect(parsed.checks[0]).toMatchObject({ name: 'Test', url: undefined });
    expect(parsed.reviews[0]).toMatchObject({ author: 'a', url: undefined });
  });
});
