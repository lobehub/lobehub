import { describe, expect, it } from 'vitest';

import { toCmdShellArgv } from './browser';

// Windows starts an npm `.cmd` shim only through cmd.exe, where Node joins argv
// into one command line: an unquoted temp path with a space split into two
// arguments, and cmd metacharacters would be interpreted.
describe('toCmdShellArgv', () => {
  it('quotes the binary and every argument', () => {
    expect(
      toCmdShellArgv('C:\\Program Files\\nodejs\\agent-browser.cmd', [
        '--config',
        'C:\\Users\\John Doe\\AppData\\Local\\Temp\\lh-browser-x\\agent-browser.json',
        '--session',
        'lobehub-topic-tpc_1',
      ]),
    ).toEqual({
      args: [
        '"--config"',
        '"C:\\Users\\John Doe\\AppData\\Local\\Temp\\lh-browser-x\\agent-browser.json"',
        '"--session"',
        '"lobehub-topic-tpc_1"',
      ],
      command: '"C:\\Program Files\\nodejs\\agent-browser.cmd"',
    });
  });

  it.each(['a"&calc', '%PATH%', 'x!y!', 'a^b', 'a\r\nb'])('refuses %j', (arg) => {
    expect(() => toCmdShellArgv('agent-browser.cmd', ['--session', arg])).toThrow(
      'Unsafe argument',
    );
  });
});
