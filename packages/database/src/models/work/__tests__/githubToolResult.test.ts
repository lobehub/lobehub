import { describe, expect, it } from 'vitest';

import { normalizeGithubToolResult } from '../githubToolResult';

/**
 * Pins the quoting edge cases of the hand-rolled shell tokenizer behind the
 * `runCommand` normalization path (see the tokenizer comment in
 * githubToolResult.ts for why it is hand-rolled).
 */
const runCommand = (command: string, output = '') =>
  normalizeGithubToolResult({
    data: { command, exitCode: 0, output },
    toolName: 'runCommand',
  });

describe('normalizeGithubToolResult (gh runCommand parsing)', () => {
  it('keeps spaces and double quotes inside single-quoted values', () => {
    const operation = runCommand(
      `gh issue create --repo lobehub/lobehub --title 'Fix: "quoted" bug report'`,
      'https://github.com/lobehub/lobehub/issues/123',
    );

    expect(operation?.params).toMatchObject({
      identifier: 'lobehub/lobehub#123',
      resourceId: 'lobehub/lobehub#123',
      changeType: 'created',
      title: 'Fix: "quoted" bug report',
      url: 'https://github.com/lobehub/lobehub/issues/123',
    });
  });

  it('unescapes \\" inside double quotes and keeps $ literal', () => {
    const operation = runCommand(
      `gh issue create --repo lobehub/lobehub --title "hello" --body "He said \\"hi\\" for $5"`,
      'https://github.com/lobehub/lobehub/issues/7',
    );

    expect(operation?.params.description).toBe('He said "hi" for $5');
    // The full `--body` value is also emitted as `content`, and both fields are
    // named in `patchFields`.
    expect(operation?.params.content).toBe('He said "hi" for $5');
    expect(operation?.params.patchFields).toEqual(
      expect.arrayContaining(['content', 'description']),
    );
  });

  it('emits the full --body as content while capping the description preview', () => {
    const body = 'C'.repeat(300);
    const operation = runCommand(
      `gh issue create --repo lobehub/lobehub --title 'Long body' --body '${body}'`,
      'https://github.com/lobehub/lobehub/issues/8',
    );

    // `content` keeps the full untruncated body; `description` is the ≤120 preview.
    expect(operation?.params.content).toBe(body);
    expect(operation?.params.description).toBe(`${'C'.repeat(120)}...`);
    expect(operation?.params.patchFields).toContain('content');
  });

  it('honors backslash escapes outside quotes', () => {
    const operation = runCommand(`gh issue edit 42 --repo lobehub/lobehub --title Fix\\ the\\ bug`);

    expect(operation?.params).toMatchObject({
      identifier: 'lobehub/lobehub#42',
      changeType: 'updated',
      title: 'Fix the bug',
    });
  });

  it('treats backslash-newline as a line continuation', () => {
    const operation = runCommand(
      `gh issue create \\\n  --repo lobehub/lobehub \\\n  --title 'Multiline invocation'`,
      'https://github.com/lobehub/lobehub/issues/9',
    );

    expect(operation?.params.title).toBe('Multiline invocation');
  });

  it('supports --flag=value with quoted values', () => {
    const operation = runCommand(
      `gh issue edit 15 --repo lobehub/lobehub --title='Inline equals title'`,
    );

    expect(operation?.params.title).toBe('Inline equals title');
  });

  it('does not misread a value-flag argument as the edit target', () => {
    const operation = runCommand(
      `gh issue edit 952 --repo lobehub/lobehub --milestone 'v2 launch'`,
    );

    expect(operation?.params.identifier).toBe('lobehub/lobehub#952');
    // Milestone is consumed as the flag value, not snapshotted as a title.
    expect(operation?.params.title).toBeUndefined();
  });

  it('skips registration on an unterminated single quote', () => {
    expect(runCommand(`gh issue create --repo lobehub/lobehub --title 'broken`)).toBeNull();
  });

  it('skips registration on an unterminated double quote', () => {
    expect(runCommand(`gh issue create --repo lobehub/lobehub --title "broken`)).toBeNull();
  });

  it('uses the last gh create/edit segment of a chained command', () => {
    const operation = runCommand(
      `git push origin HEAD && gh pr create --base main --title 'New PR'`,
      'https://github.com/lobehub/lobehub/pull/88',
    );

    expect(operation?.params).toMatchObject({
      identifier: 'lobehub/lobehub#88',
      resourceType: 'github_pull_request',
      changeType: 'created',
      title: 'New PR',
    });
  });

  it('splits segments on semicolons and parses the last gh segment', () => {
    const operation = runCommand(
      `gh issue edit 1 --add-label bug; gh pr edit 7 --repo lobehub/lobehub --title 'Second'`,
    );

    expect(operation?.params).toMatchObject({
      identifier: 'lobehub/lobehub#7',
      changeType: 'updated',
      title: 'Second',
    });
  });
});

/**
 * The persisted url reaches shell.openExternal on desktop, and gh stdout is
 * member-controlled free text, so only http(s) URLs may be stored.
 */
describe('normalizeGithubToolResult (url scheme allowlist)', () => {
  const editWithStdoutUrl = (url: string) =>
    // `gh issue edit 5` supplies repo+number identity; the stdout URL is the
    // attacker-controlled value under test.
    runCommand(`gh issue edit 5 --repo lobehub/lobehub`, url);

  it.each([
    ['javascript:alert(1)', 'javascript'],
    ['data:text/html,x', 'data'],
    ['file:///etc/passwd', 'file'],
  ])('drops the persisted url for a %s scheme', (url) => {
    // A non-github scheme never matches the entity-URL regex, so the ref falls
    // back to the command's edit target (number 5) and carries no url.
    const operation = editWithStdoutUrl(url);

    expect(operation?.params.identifier).toBe('lobehub/lobehub#5');
    expect(operation?.params.url).toBeUndefined();
  });

  it('keeps a plain https github url', () => {
    const operation = runCommand(
      `gh issue create --repo lobehub/lobehub --title 'ok'`,
      'https://github.com/lobehub/lobehub/issues/321',
    );

    expect(operation?.params.url).toBe('https://github.com/lobehub/lobehub/issues/321');
  });

  it('keeps a structured-result html_url only when it is http(s)', () => {
    const good = normalizeGithubToolResult({
      data: { html_url: 'https://github.com/lobehub/lobehub/issues/9', number: 9 },
      args: { owner: 'lobehub', repo: 'lobehub' },
      toolName: 'create_issue',
    });
    expect(good?.params.url).toBe('https://github.com/lobehub/lobehub/issues/9');

    const bad = normalizeGithubToolResult({
      data: { html_url: 'javascript:alert(1)', number: 9 },
      args: { owner: 'lobehub', repo: 'lobehub' },
      toolName: 'create_issue',
    });
    expect(bad?.params.identifier).toBe('lobehub/lobehub#9');
    expect(bad?.params.url).toBeUndefined();
  });
});
