import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { commandInvokesEmbeddedCli } from './commandInvokesCli';

const electronUserData = vi.hoisted(() => ({ path: '/userData' }));

vi.mock('electron', () => ({ app: { getPath: () => electronUserData.path } }));

const wrapper = path.join('/userData', 'bin', 'lh');

describe('commandInvokesEmbeddedCli', () => {
  it.each([
    'lh goal show g',
    'cd /repo && lh goal show g',
    'export PATH="/x:$PATH"; lh goal plan g --token t --file p.json',
    'FOO=1 lh whoami',
    "FOO='a b' lh whoami",
    'timeout 60 lh whoami',
    'timeout -k 5 60 lh whoami',
    'nohup lh whoami &',
    'cat ids | xargs lh goal show',
    'if lh whoami; then echo ok; fi',
    'for g in a b; do lh goal show "$g"; done',
    'cd /repo && \\\n  lh whoami',
    "bash -lc 'lh whoami'",
    'sh -c "cd /x && lh whoami"',
    'out=$(lh whoami)',
    'echo "$(lh whoami)"',
    'echo `lh whoami`',
    `"${wrapper}" goal show g`,
    `cd /repo && ${wrapper} goal show g`,
  ])('matches %s', (command) => {
    expect(commandInvokesEmbeddedCli(command)).toBe(true);
  });

  it('finds lh after a heredoc whose body has an apostrophe', () => {
    const command = `cat > plan.json <<'EOF'\n{"reason":"don't guess"}\nEOF\nlh goal plan g --file plan.json`;
    expect(commandInvokesEmbeddedCli(command)).toBe(true);
  });

  it('matches the wrapper through a shell-escaped space', () => {
    electronUserData.path = '/Users/m/Application Support/LobeHub';
    try {
      expect(
        commandInvokesEmbeddedCli(
          String.raw`/Users/m/Application\ Support/LobeHub/bin/lh goal show g`,
        ),
      ).toBe(true);
    } finally {
      electronUserData.path = '/userData';
    }
  });

  it.each([
    String.raw`printf 'lh\n'; env`,
    'echo lh; env',
    'echo "cd x && lh whoami"; env',
    "echo 'a; lh whoami'; env",
    'echo do lh',
    'grep -r lh .',
    '# lh whoami\nenv',
    "cat <<'EOF'\nlh whoami\nEOF\nenv",
    `cat "${wrapper}"`,
    'ls ./lh',
    'cat /opt/lh',
    'node lh.js',
    'lhtest run',
    'pnpm --filter lobehub test',
    'cd ~/lobehub && git status',
  ])('ignores %s', (command) => {
    expect(commandInvokesEmbeddedCli(command)).toBe(false);
  });
});
