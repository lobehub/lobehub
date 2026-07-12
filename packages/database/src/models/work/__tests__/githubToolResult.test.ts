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
      number: 123,
      repo: 'lobehub/lobehub',
      resourceIdentifier: 'lobehub/lobehub#123',
      role: 'created',
      title: 'Fix: "quoted" bug report',
      url: 'https://github.com/lobehub/lobehub/issues/123',
    });
  });

  it('unescapes \\" inside double quotes and keeps $ literal', () => {
    const operation = runCommand(
      `gh issue create --repo lobehub/lobehub --title "hello" --body "He said \\"hi\\" for $5"`,
      'https://github.com/lobehub/lobehub/issues/7',
    );

    expect(operation?.params.body).toBe('He said "hi" for $5');
  });

  it('honors backslash escapes outside quotes', () => {
    const operation = runCommand(`gh issue edit 42 --repo lobehub/lobehub --title Fix\\ the\\ bug`);

    expect(operation?.params).toMatchObject({
      number: 42,
      role: 'updated',
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

    expect(operation?.params.number).toBe(952);
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
      baseRef: 'main',
      number: 88,
      resourceType: 'github_pull_request',
      role: 'created',
      title: 'New PR',
    });
  });

  it('splits segments on semicolons and parses the last gh segment', () => {
    const operation = runCommand(
      `gh issue edit 1 --add-label bug; gh pr edit 7 --repo lobehub/lobehub --title 'Second'`,
    );

    expect(operation?.params).toMatchObject({
      number: 7,
      repo: 'lobehub/lobehub',
      role: 'updated',
      title: 'Second',
    });
  });
});
